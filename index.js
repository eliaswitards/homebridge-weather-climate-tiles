'use strict';
const https = require('node:https');
const PLUGIN = 'homebridge-openmeteo-climate';
const PLATFORM = 'OpenMeteoClimate';
const PREFIX = 'Open-Meteo';

const bounded = (v, d, lo, hi) => Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d;
const validNumber = v => typeof v === 'number' && Number.isFinite(v);
function getJSON(url, timeoutMs=12000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {headers: {'User-Agent': 'homebridge-openmeteo-climate/0.5.0-rc.1 (open-source)'}}, res => {
      let body = '';
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`Weather HTTP ${res.statusCode}`)); return; }
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; if (body.length > 1500000) req.destroy(new Error('Weather response too large')); });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(new Error(`Invalid weather response: ${e.message}`)); } });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Weather request timed out')));
    req.on('error', reject);
  });
}
function interpretWeather(data, cfg) {
  if (data.error) throw new Error(`Open-Meteo: ${String(data.reason || 'API error')}`);
  const c = data.current || {};
  if (!validNumber(c.temperature_2m) || !validNumber(c.relative_humidity_2m)) throw new Error('Open-Meteo returned no current temperature/humidity');
  const h = data.hourly || {};
  const now = Date.parse(c.time + (/[zZ]|[+-]\d\d:\d\d$/.test(c.time) ? '' : 'Z'));
  const windowMs = cfg.forecastHours * 3600000;
  const points=[];
  if (Array.isArray(h.time)) {
    h.time.forEach((time,i)=>{
      const t=Date.parse(time + (/[zZ]|[+-]\d\d:\d\d$/.test(time) ? '' : 'Z'));
      if (Number.isFinite(t) && t >= now - 3600000 && t <= now + windowMs) {
        points.push({t,temp:h.temperature_2m?.[i], rain:h.rain?.[i], snow:h.snowfall?.[i], code:h.weather_code?.[i], wind:h.wind_gusts_10m?.[i], speed:h.wind_speed_10m?.[i]});
      }
    });
  }
  // Open-Meteo 15-minute rain/snow values represent the *preceding 15 minutes*.
  // Prefer the newest complete interval, converting its accumulation to an
  // equivalent hourly rate for the existing fan tile percentage scales.
  const m=data.minutely_15 || {};
  let quarter=null;
  if(Array.isArray(m.time)) {
    for(let i=0;i<m.time.length;i++) {
      const time=m.time[i];
      const t=Date.parse(time + (/[zZ]|[+-]\d\d:\d\d$/.test(time) ? '' : 'Z'));
      if(Number.isFinite(t) && t<=now && (!quarter || t>quarter.t) &&
         (validNumber(m.rain?.[i]) || validNumber(m.snowfall?.[i]))) {
        quarter={t,rain:m.rain?.[i],snow:m.snowfall?.[i]};
      }
    }
  }
  // Wind alert is gust-based when gusts are available; the wind-speed tile
  // displays sustained modelled wind speed, not gust speed.
  const gustNow = validNumber(c.wind_gusts_10m) ? c.wind_gusts_10m : c.wind_speed_10m;
  const speedNow = validNumber(c.wind_speed_10m) ? c.wind_speed_10m : c.wind_gusts_10m;
  const wind = (validNumber(gustNow) && gustNow >= cfg.windThresholdKmh) || points.some(p=>validNumber(p.wind) && p.wind >= cfg.windThresholdKmh);
  const snow = (validNumber(c.snowfall) && c.snowfall > 0) || [71,73,75,77,85,86].includes(c.weather_code) || points.some(p=>(validNumber(p.snow) && p.snow > 0) || [71,73,75,77,85,86].includes(p.code));
  const frost = c.temperature_2m <= cfg.frostThresholdC || points.some(p=>validNumber(p.temp) && p.temp <= cfg.frostThresholdC);
  // Hourly rain is in mm per preceding hour; snowfall is in cm per preceding hour.
  // Choose the most recent model hour no later than current time when available.
  const preceding=points.filter(p=>p.t<=now).sort((a,b)=>b.t-a.t)[0];
  const rainMm=validNumber(quarter?.rain)?quarter.rain*4:(validNumber(preceding?.rain)?preceding.rain : (validNumber(c.rain)?c.rain:0));
  const snowCm=validNumber(quarter?.snow)?quarter.snow*4:(validNumber(preceding?.snow)?preceding.snow : (validNumber(c.snowfall)?c.snowfall:0));
  const precipitationSource=quarter && (validNumber(quarter.rain)||validNumber(quarter.snowfall)) ? '15-minute forecast (hourly equivalent)' : 'hourly/current forecast';
  const temperatures=[c.temperature_2m,...points.map(p=>p.temp)].filter(validNumber);
  const minTemp=Math.min(...temperatures);
  const freezingCode=[56,57,66,67].includes(c.weather_code)||points.some(p=>[56,57,66,67].includes(p.code));
  const forecastWet=points.some(p=>(validNumber(p.rain)&&p.rain>0)||(validNumber(p.snow)&&p.snow>0));
  // Heuristic risk tiers, not calibrated probabilities of ice forming.
  const iceLevel=freezingCode?100:minTemp<=0&&forecastWet?75:minTemp<=0?50:minTemp<=cfg.frostThresholdC?25:0;
  return {temp:c.temperature_2m, humidity:c.relative_humidity_2m, wind:!!wind, snow:!!snow, frost:!!frost, windKmh:speedNow, pressure:c.pressure_msl, rainMm, snowCm, iceLevel, precipitationSource};
}

class WeatherPlatform {
  constructor(log, config, api) {
    this.log=log; this.config=config || {}; this.api=api;
    this.Service=api.hap.Service; this.Characteristic=api.hap.Characteristic;
    this.accessories=new Map();
    this.conditionState={wind:false,snow:false,frost:false};
    this.windMph=0;
    this.displayValues={rain:0,snow:0,ice:0};
    this.cfg={
      latitude: Number(this.config.latitude), longitude:Number(this.config.longitude),
      refreshMinutes: bounded(this.config.refreshMinutes,30,15,180),
      forecastHours:bounded(this.config.forecastHours,3,1,12),
      windThresholdKmh:bounded(this.config.windThresholdKmh,40,5,200),
      frostThresholdC:bounded(this.config.frostThresholdC,2,-10,10),
    };
    if (!Number.isFinite(this.cfg.latitude) || Math.abs(this.cfg.latitude)>90 || !Number.isFinite(this.cfg.longitude) || Math.abs(this.cfg.longitude)>180) {
      this.log.error('Set valid latitude/longitude before starting this platform.'); this.invalid=true;
    }
    api.on('didFinishLaunching',()=>this.start());
    api.on('shutdown',()=>{if(this.timer) clearInterval(this.timer);});
  }
  configureAccessory(accessory) {this.accessories.set(accessory.UUID, accessory);}
  ensureAccessory(id, name, type) {
    const uuid = this.api.hap.uuid.generate(`${PLUGIN}:${id}`);
    let a = this.accessories.get(uuid);
    let changed = !a;

    if (!a) {
      a = new this.api.platformAccessory(name, uuid);
      this.api.registerPlatformAccessories(PLUGIN, PLATFORM, [a]);
      this.accessories.set(uuid, a);
    }

    let svc = a.getService(type);
    if (!svc) {
      svc = a.addService(type, name);
      changed = true;
    }

    if (a.displayName !== name) {
      a.displayName = name;
      changed = true;
    }

    const info = a.getService(this.Service.AccessoryInformation);
    if (info) {
      const infoName = info.getCharacteristic(this.Characteristic.Name);
      if (infoName.value !== name) {
        info.setCharacteristic(this.Characteristic.Name, name);
        changed = true;
      }
    }

    if (svc.displayName !== name) {
      svc.displayName = name;
      changed = true;
    }

    const serviceName = svc.getCharacteristic(this.Characteristic.Name);
    if (serviceName.value !== name) {
      svc.setCharacteristic(this.Characteristic.Name, name);
      changed = true;
    }

    if (changed) {
      this.api.updatePlatformAccessories([a]);
    }

    return {a, svc};
  }
  makeSensors() {
    const label=String(this.config.name || 'Outdoor').trim() || 'Outdoor';
    const names={temp:`${label} Temperature`, humidity:`${label} Humidity`,wind:`${label} Strong Wind`,snow:`${label} Snow Forecast`,frost:`${label} Frost Risk`};
    this.sensors={
      temp:this.ensureAccessory('temperature',names.temp,this.Service.TemperatureSensor),
      humidity:this.ensureAccessory('humidity',names.humidity,this.Service.HumiditySensor),
    };
    for(const id of ['wind','snow','frost']) {
      if(this.config[`show${id[0].toUpperCase()+id.slice(1)}`]!==false) this.sensors[id]=this.ensureAccessory(id,names[id],this.Service.OccupancySensor);
    }
    // Additional *separate* Home app tiles. Keep original occupancy sensors and UUIDs
    // intact so any existing scenes or automations remain associated with them.
    if(this.config.showConditionTiles!==false) {
      const tileNames={wind:`${label} Wind Alert`,snow:`${label} Snow Alert`,frost:`${label} Frost Alert`};
      for(const id of ['wind','snow','frost']) {
        const tile=this.ensureAccessory(`${id}-tile`,tileNames[id],this.Service.Switch);
        tile.svc.getCharacteristic(this.Characteristic.On)
          .onGet(()=>this.conditionState[id])
          .onSet(()=>{
            // HomeKit Switch requires a writable characteristic. Reject attempted
            // manual changes rather than falsely displaying an altered forecast.
            throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.READ_ONLY_CHARACTERISTIC);
          });
        this.sensors[`${id}Tile`]=tile;
      }
    }
    // Experimental wind-speed display: HomeKit Fanv2 supports 0–100% only.
    // For testing, 1 percentage point represents 1 mph (rounded, capped at 100).
    // This is a display workaround, not a controllable fan or real HomeKit mph value.
    if(this.config.showExperimentalWindFan!==false) {
      const fan=this.ensureAccessory('wind-speed-fan', 'Wind Speed', this.Service.Fanv2);
      const denyWrite=()=>{throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.READ_ONLY_CHARACTERISTIC);};
      fan.svc.getCharacteristic(this.Characteristic.Active)
        .onGet(()=>this.conditionState.wind ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE)
        .onSet(denyWrite);
      fan.svc.getCharacteristic(this.Characteristic.RotationSpeed)
        .onGet(()=>Math.round(Math.min(100,Math.max(0,this.windMph))))
        .onSet(denyWrite);
      this.sensors.windSpeedFan=fan;
    }
    // Additional experimental Climate fan tiles; new UUIDs preserve all existing accessories.
    // Rain: 1% = 0.1 mm/hour; Snow: 1% = 0.1 cm/hour;
    // Ice risk: categorical heuristic 0,25,50,75,100 (NOT a probability).
    if(this.config.showExperimentalWeatherFans!==false) {
      const labels={rain:'Rainfall',snow:'Snowfall',ice:'Ice and Frost Risk'};
      for(const id of ['rain','snow','ice']) {
        const fan=this.ensureAccessory(`${id}-weather-fan`,labels[id],this.Service.Fanv2);
        const deny=()=>{throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.READ_ONLY_CHARACTERISTIC);};
        fan.svc.getCharacteristic(this.Characteristic.Active)
          .onGet(()=>this.displayValues[id]>0?this.Characteristic.Active.ACTIVE:this.Characteristic.Active.INACTIVE)
          .onSet(deny);
        fan.svc.getCharacteristic(this.Characteristic.RotationSpeed)
          .onGet(()=>this.displayValues[id]).onSet(deny);
        this.sensors[`${id}WeatherFan`]=fan;
      }
    }
    // Delete only stale accessories belonging to this plugin (not other bridges/plugins).
    const retained=new Set(Object.values(this.sensors).map(v=>v.a.UUID));
    const stale=Array.from(this.accessories.values()).filter(a=>!retained.has(a.UUID));
    if(stale.length) {this.api.unregisterPlatformAccessories(PLUGIN,PLATFORM,stale);stale.forEach(a=>this.accessories.delete(a.UUID));}
    this.sensors.temp.svc.updateCharacteristic(this.Characteristic.StatusActive,false);
    this.sensors.humidity.svc.updateCharacteristic(this.Characteristic.StatusActive,false);
  }
  start() {
    if(this.invalid) return;
    this.makeSensors();
    this.poll();
    this.timer=setInterval(()=>this.poll(),this.cfg.refreshMinutes*60000);
    this.timer.unref?.();
    this.log.info(`Open-Meteo at ${this.cfg.latitude}, ${this.cfg.longitude}; refresh ${this.cfg.refreshMinutes} minutes; no API key.`);
  }
  async poll() {
    if(this.inFlight) return;
    this.inFlight=true;
    try {
      const fields='temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,rain,snowfall,weather_code,pressure_msl';
      const hourly='temperature_2m,wind_speed_10m,wind_gusts_10m,rain,snowfall,weather_code';
      const params=new URLSearchParams({latitude:String(this.cfg.latitude),longitude:String(this.cfg.longitude),current:fields,hourly,minutely_15:'rain,snowfall',forecast_hours:String(this.cfg.forecastHours+2),past_minutely_15:'4',timezone:'GMT',wind_speed_unit:'kmh'});
      const data=await getJSON(`https://api.open-meteo.com/v1/forecast?${params}`);
      const v=interpretWeather(data,this.cfg);
      this.sensors.temp.svc.updateCharacteristic(this.Characteristic.CurrentTemperature,bounded(v.temp,0,-100,100));
      this.sensors.humidity.svc.updateCharacteristic(this.Characteristic.CurrentRelativeHumidity,bounded(v.humidity,0,0,100));
      this.sensors.temp.svc.updateCharacteristic(this.Characteristic.StatusActive,true);
      this.sensors.humidity.svc.updateCharacteristic(this.Characteristic.StatusActive,true);
      for(const id of ['wind','snow','frost']) {
        this.conditionState[id]=!!v[id];
        if(this.sensors[id]) this.sensors[id].svc.updateCharacteristic(this.Characteristic.OccupancyDetected,v[id] ? this.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED : this.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
        if(this.sensors[`${id}Tile`]) this.sensors[`${id}Tile`].svc.updateCharacteristic(this.Characteristic.On,!!v[id]);
      }
      if(this.sensors.windSpeedFan) {
        this.windMph=validNumber(v.windKmh)?v.windKmh/1.609344:0;
        const display=Math.round(Math.min(100,Math.max(0,this.windMph)));
        this.sensors.windSpeedFan.svc.updateCharacteristic(this.Characteristic.RotationSpeed, display);
        this.sensors.windSpeedFan.svc.updateCharacteristic(this.Characteristic.Active,
          v.wind ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE);
        this.log.info(`Experimental wind fan: ${display}% represents ${this.windMph.toFixed(1)} mph; state ${v.wind?'ON (wind warning)':'OFF (no wind warning)'}.`);
      }
      if(this.config.showExperimentalWeatherFans!==false) {
        const scale={rain:Math.round(Math.min(100,Math.max(0,v.rainMm*10))),snow:Math.round(Math.min(100,Math.max(0,v.snowCm*10))),ice:v.iceLevel};
        for(const id of ['rain','snow','ice']) {
          this.displayValues[id]=scale[id];
          const fan=this.sensors[`${id}WeatherFan`];
          if(fan){
            fan.svc.updateCharacteristic(this.Characteristic.RotationSpeed,scale[id]);
            fan.svc.updateCharacteristic(this.Characteristic.Active,scale[id]>0?this.Characteristic.Active.ACTIVE:this.Characteristic.Active.INACTIVE);
          }
        }
        this.log.info(`Weather fan tiles: rain=${v.rainMm.toFixed(2)} mm/h (${scale.rain}%), snow=${v.snowCm.toFixed(2)} cm/h (${scale.snow}%), ice risk level=${scale.ice}/100 (categorical model heuristic); source=${v.precipitationSource}.`);
      }
      this.log.info(`Outdoor ${v.temp}°C, humidity ${v.humidity}%, wind ${validNumber(v.windKmh)?(v.windKmh / 1.609344).toFixed(1)+' mph':'n/a'}, pressure ${validNumber(v.pressure)?v.pressure+' hPa':'n/a'}; indicators: wind=${v.wind}, snow=${v.snow}, frost=${v.frost} (model estimates)`);
    }catch(err){
      this.log.warn(`Weather update failed: ${err.message}; retaining previous values.`);
      if(this.sensors) {
        this.sensors.temp.svc.updateCharacteristic(this.Characteristic.StatusActive,false);
        this.sensors.humidity.svc.updateCharacteristic(this.Characteristic.StatusActive,false);
      }
    }finally {this.inFlight=false;}
  }
}
module.exports = api=>api.registerPlatform(PLUGIN,PLATFORM,WeatherPlatform);
module.exports._test={interpretWeather};
