# Synthetic SFDPS lifecycle payloads

No public non-`TH` SFDPS payload could be found, so these flight-plan lifecycle messages are written
by hand from the FIXM 3.0 / NAS 3.0 schema, in exactly the shape of the real payloads in
`../nasa-race/` (namespaced `MessageCollection` root, unqualified children, `xsi:type` attributes).
Replace them with recorded messages (`SWIM_RECORD_DIR`) once SCDS access is in place.

Files replay in name order: AAL558 KDFW→KLAX is filed, amended, departs (inside a batch that also
carries track messages) and arrives; DAL1234 KATL→KMCO is filed and then cancelled.
