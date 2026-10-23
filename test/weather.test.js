'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { _test: { interpretWeather } } = require('../index');
const cfg = { forecastHours: 3, windThresholdKmh: 40, frostThresholdC: 2 };
const base = () => ({
  current: { time: '2026-10-23T12:00', temperature_2m: 8, relative_humidity_2m: 65,
    wind_speed_10m: 20, wind_gusts_10m: 48, rain: 0, snowfall: 0, weather_code: 2 },
  hourly: { time: ['2026-10-23T12:00','2026-10-23T13:00'],
    temperature_2m: [8,7], wind_gusts_10m: [48,30], rain:[0,0], snowfall:[0,0], weather_code:[2,2] }
});
test('distinguishes wind speed from wind-gust alert', () => {
  const v = interpretWeather(base(), cfg);
  assert.equal(v.wind, true);
  assert.equal(v.windKmh, 20);
  assert.equal(v.temp, 8);
  assert.equal(v.humidity, 65);
});
test('converts recent 15-minute precipitation to hourly-equivalent rate', () => {
  const data = base();
  data.minutely_15 = { time:['2026-10-23T11:45','2026-10-23T12:15'], rain:[0.4,2], snowfall:[0.1,1] };
  const v = interpretWeather(data, cfg);
  assert.equal(v.rainMm, 1.6);
  assert.equal(v.snowCm, 0.4);
  assert.match(v.precipitationSource,/15-minute/);
});
test('uses hourly rain when minutely data is absent', () => {
  const data = base(); data.hourly.rain[0]=2.5;
  assert.equal(interpretWeather(data,cfg).rainMm,2.5);
});
test('reports frost and categorical ice-risk tier', () => {
  const data=base(); data.hourly.temperature_2m[1]=-1; data.hourly.rain[1]=1;
  const v=interpretWeather(data,cfg);
  assert.equal(v.frost,true);
  assert.equal(v.iceLevel,75);
});
test('rejects missing required current measurements', () => {
  const data=base(); delete data.current.relative_humidity_2m;
  assert.throws(()=>interpretWeather(data,cfg),/no current temperature\/humidity/);
});
test('rejects API errors',()=>assert.throws(()=>interpretWeather({error:true,reason:'invalid'},cfg),/Open-Meteo/));
