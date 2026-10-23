# Homebridge Open-Meteo Climate

Free, open-source weather estimates in Apple Home through [Homebridge](https://homebridge.io/), maintained under the **Elias Witards** developer identity.

> Status: Version 0.5.0-rc.1 is published on npm as a public release candidate for testing. This is not yet a stable release. This repository contains a working prototype prepared for wider testing. It is **not** an official Apple Home or Open-Meteo product.

## What it adds to Apple Home

- Temperature and relative humidity sensors.
- Optional occupancy-style indicators for strong wind, snow forecast and frost risk.
- Optional read-only-style switch tiles for the same conditions.
- Experimental **fan-style display tiles** in the Climate area:

| Tile | Apple Home display | Actual meaning |
|---|---|---|
| Wind Speed | 1% = 1 mph | Modelled current wind speed, rounded, capped at 100 mph |
| Rainfall | 10% = 1 mm/hour | Modelled rain-rate equivalent, capped at 10 mm/hour |
| Snowfall | 10% = 1 cm/hour | Modelled snowfall-rate equivalent, capped at 10 cm/hour |
| Ice / Frost Risk | 0, 25, 50, 75 or 100% | **Categorical heuristic only; not a probability** |

**Important:** Apple Home calls these accessories *fans*, but they are **not real fans** and cannot be controlled. Attempts to change their values in Home may produce an error. Percentages are a display workaround, not native weather measurements. Wind warning status uses modelled gusts when available; the wind-speed tile uses modelled wind speed.

## Requirements

- Homebridge 2.x and Node.js 20 or newer (as declared in the package metadata).
- A working Homebridge-to-Apple-Home connection.
- Internet access to `api.open-meteo.com`.
- A location's latitude and longitude.

## Installation (after public npm release)

Install `homebridge-openmeteo-climate` using the Homebridge UI plugin search. Configure your location using the plugin settings, save, then restart the plugin's bridge as directed by Homebridge. **This release candidate is not published yet.**

For developers testing a local checkout, run `npm test` and `npm install -g /path/to/homebridge-openmeteo-climate` on a *test* Homebridge installation. Do not replace a working installation without a backup.

## Example configuration

Use the Homebridge UI settings or add a platform entry to your Homebridge `config.json`:

```json
{
  "platform": "OpenMeteoClimate",
  "name": "My Location",
  "latitude": 51.5,
  "longitude": -0.12,
  "refreshMinutes": 30,
  "forecastHours": 3,
  "windThresholdKmh": 40,
  "frostThresholdC": 2,
  "showWind": true,
  "showSnow": true,
  "showFrost": true,
  "showConditionTiles": true,
  "showExperimentalWindFan": true,
  "showExperimentalWeatherFans": true
}
```

**The coordinates above are illustrative only.** Replace them with your own location. Do not paste private Homebridge `config.json` files into public bug reports: they may contain credentials for unrelated plugins.

## How readings are calculated

The plugin requests Open-Meteo current, hourly and (when available) 15-minute forecast data. It refreshes every 30 minutes by default (configurable between 15 and 180 minutes). Rain and snowfall tiles convert a 15-minute model amount into an *hourly-equivalent* rate by multiplying by four; otherwise they fall back to hourly/current values. Forecast updates can lag local weather, and values are not direct observations.

Wind alerts use current gusts when available or hourly forecast gusts above the configured threshold. Snow and frost indicators include a configurable future window. Ice-risk levels are rough rules based on forecast temperature, precipitation and freezing-precipitation codes. They are **not measured ice, road condition reports, calibrated risk percentages, or safety alerts**.

## Privacy and API use

The plugin sends the configured latitude and longitude to the Open-Meteo forecast API over HTTPS to obtain weather data. It does not require an Open-Meteo API key in eligible non-commercial use. Review [Open-Meteo's terms](https://open-meteo.com/en/terms) before use, especially for commercial projects. This project is not affiliated with Open-Meteo.

Weather data provided by [Open-Meteo](https://open-meteo.com/). Please follow any attribution requirements applicable to your use and selected data sources.

## Limitations and safety

- Weather models may be wrong or delayed; do not rely on this plugin for emergency, aviation, marine, severe-weather or personal safety decisions.
- Fan-style tiles are a HomeKit display workaround and their appearance can change with Apple Home updates.
- This is not a physical rain gauge, anemometer, snow sensor or ice detector.
- Some HomeKit versions may show a warning when a user attempts to operate the simulated fans or switches.
- This project has only had limited private real-world testing so far; more testing is needed before a stable 1.0 release.

## Support and contributions

Please use [GitHub Issues](https://github.com/eliaswitards/homebridge-weather-climate-tiles/issues) for reproducible bugs, and include your Homebridge and Node versions (but **never credentials**). Contributions and improvements are welcome under the MIT licence.

**Free to use. Donations welcome** — an optional support link will be added later. Donations do not buy additional features or support commitments.

## Licence

MIT — see [LICENSE](LICENSE).
