# MPP Console Data Feasibility Matrix

This matrix classifies target widgets by implementation feasibility.

## Category A: Available Now (existing direct fields)

Live Console:
- Recommendation, severity, confidence, stability, trend reason
- Session health and freshness metrics
- Relay endpoint metadata
- Selected car snapshot (lap, position, tyre, tyre age, fuel, ERS)
- Race order table baseline fields
- Notes and timeline events

Replay Console:
- Archive summary
- Unified timeline
- Snapshot focus
- Recommendation at snapshot
- Notes and ops events at timestamp

## Category B: Derivable Now (computed from existing data)

- Call Strength
- Pit Window ETA
- Traffic Exposure
- Tyre/Fuel Stress
- Execution Readiness
- Clean Air Probability
- Strategy delta versus rival (coarse)
- Rejoin position estimate (coarse)

Implementation rule:
- Must include short metric sublabel that explains composition.

## Category C: Requires Telemetry Expansion (not in current source)

- Engine wear trend (high-fidelity)
- Wing aero loss
- Throttle pressure traces
- Brake pressure traces
- RPM sync precision traces
- Estimated crossover lap (high-confidence variant)

Implementation rule:
- Do not use fake placeholders as final UI.
- Keep blocked items in telemetry backlog until source exists.

## UX Transparency Rule

Every synthetic metric shown in UI should include one of:
- Inline sublabel with formula hint
- Tooltip that states source signals and confidence bounds

## Runtime Visibility Rule

All new console surfaces should include:
- relay endpoint indicator
- health chip
- canonical session marker
- session_rebound banner when transition is detected
