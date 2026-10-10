# Real SFDPS FIXM payloads (NASA RACE)

Unmodified copies of SFDPS test payloads from NASA RACE (Runtime for Airspace Concept Evaluation),
https://github.com/NASARace/race at commit `976cdca20293b354ef33a8a8051672f0d4d673c4`:

| File | Original path |
|---|---|
| `MessageCollection-TH-36.xml` | `race-air-test/src/test/resources/MessageCollection.xml` |
| `NasFlight-TH-single.xml` | `race-air-test/src/test/resources/sfdps-nasflight.xml` |

Copyright (c) 2023, United States Government, as represented by the Administrator of the National
Aeronautics and Space Administration. All rights reserved. Licensed under the Apache License,
Version 2.0 (`LICENSE-2.0.txt` in this directory).

Both are `TH` (track) messages; WebFly uses them to test the prefilter and the parser's handling of
real namespace prefixes, both root shapes and missing fields.
