## 0.5.0-rc.2 — 23 October 2026

### Fixed
- Corrected invalid HomeKit accessory and service names for wind speed, rainfall, snowfall and ice/frost risk.
- Added automatic migration of previously cached accessory names.
- Preserved existing accessory UUIDs during name migration.
- Reduced unnecessary accessory-cache updates by saving changes only when required.

### Verification
- All six automated weather tests passed.
- Successfully tested with Homebridge 2.4.0.
- Verified restoration of 12 cached accessories.
- Verified migration from older accessory names and a warning-free restart.

# Changelog

## 0.5.0-rc.1 (unpublished release candidate)

- Prepared metadata, neutral configuration examples, MIT licence and public documentation.
- Clarified that the wind-speed fan displays modelled wind speed, while strong-wind alerts prefer gusts.
- Added initial automated tests for the weather interpretation function.
- Preserved all existing accessory UUIDs, platform IDs and sensor/fan names from 0.4.1.

## 0.4.1 (private prototype)

- Added 15-minute precipitation data handling with hourly-equivalent display scales.
- Kept existing weather tiles and model-based risk indicators.
