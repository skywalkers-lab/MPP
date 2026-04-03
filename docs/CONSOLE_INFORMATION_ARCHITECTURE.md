# MPP Console Information Architecture

This document freezes the information architecture for two new top-level products:
- Live Strategic Console
- Replay Console

Scope of this document:
- Information zones and required data
- Decision hierarchy and operator flow
- Mapping to existing MPP data sources

Out of scope:
- Final visual polish
- Advanced telemetry widgets that require new telemetry sources

## Product Intent

MPP is evolving from multiple utility surfaces into two mission-focused consoles:
- Live Strategic Console: real-time decision and command support
- Replay Console: synchronized incident review with timeline context

## Live Strategic Console IA

### Zone A: Top Strategy Strip
Purpose:
- Expose current call priority and confidence in one scan.

Required blocks:
- Primary recommendation
- Secondary recommendation
- Call Strength
- Pit Window ETA
- Traffic Exposure
- Tyre/Fuel Stress
- Execution Readiness
- Clean Air Probability

Interaction:
- Hover/tooltip explains metric composition and source signals.

### Zone B: Left Driver State Panel
Purpose:
- Maintain immediate awareness of selected car state.

Required blocks:
- Fuel margin
- Stint phase
- Tyre compound
- Tyre age
- Tyre temperature when available
- Gear
- RPM
- Speed

### Zone C: Center Tactical Board
Purpose:
- Support tactical judgement in track context.

Required blocks:
- Track context canvas (v1 placeholder allowed)
- Selected car marker
- Nearby rival markers when available
- Clean air window card
- Undercut risk card

### Zone D: Right Strategy Projection
Purpose:
- Show strategy output and impact projection.

Required blocks:
- Degradation projection
- Pit window open lap
- Rejoin position estimate
- Strategy delta versus target rival

### Zone E: Bottom Race Table
Purpose:
- Read field order and threats without changing page.

Required columns:
- Position
- Driver
- Gap
- Interval
- Threat
- Stint
- Tyre
- Pit count

### Zone F: Bottom Event Rail
Purpose:
- Keep temporal narrative visible during decisions.

Required streams:
- Team radio
- Race control
- Strategy engine

Behavior:
- Newest events append in time order.
- Stream filters allowed in later phase.

### Zone G: Action Strip
Purpose:
- Keep high-frequency strategic commands one click away.

Required controls:
- BOX THIS LAP
- PUSH NOW
- HARVEST MODE
- HOLD POS

v1 behavior:
- Command controls can start as UI-intent actions with event logging.

## Replay Console IA

### Zone A: Left Classification Panel
Purpose:
- Keep ranking and interval context fixed while reviewing snapshots.

Required blocks:
- Driver ranking
- Interval to leader or selected reference

### Zone B: Header and Session Metadata
Purpose:
- Anchor replay context.

Required blocks:
- Session id
- Grand prix and lap context when available
- Timecode
- Replay sync status
- Relay endpoint and health summary

### Zone C: Center Top Sync Telemetry
Purpose:
- Compare telemetry trend around selected replay time.

Required blocks:
- Multi-series graph container
- Time cursor synced with scrubber

### Zone D: Center Bottom Sector Map / Driver Sync View
Purpose:
- Visualize where the selected event occurred.

Required blocks:
- Sector map or positional sync panel
- Selected timestamp indicator

### Zone E: Right Event Log
Purpose:
- Show what happened and why around selected time.

Required entries:
- Race events
- Ops events
- Notes
- Strategy recommendation changes

### Zone F: Bottom Scrubber and Playback Controls
Purpose:
- Navigate archive timeline as a coherent sequence.

Required controls:
- Play / pause
- Step backward / step forward
- Scrubber thumb
- Timecode display and direct jump
- Playback speed selector (later phase allowed)

v1 hard requirement:
- Scrubber and snapshot focus must be functional.

## Archive Integration Rules

Replay Console must absorb current archive functionality:
- Snapshot focus
- Unified timeline
- Strategy recommendation at snapshot
- Notes
- Ops events

User outcome:
- Operator can answer: what happened, when it happened, and what strategy output said at that exact time.

## Shared Platform Signals

All consoles and legacy surfaces should consistently expose:
- Relay endpoint
- Health state
- Canonical session state
- session_rebound transition banner

## Delivery Sequence

1. IA freeze and design system skeleton
2. Live Strategic Console v1 using existing data and existing APIs
3. Replay Console v1 using archive timeline and snapshot focus
4. Advanced telemetry and projection widgets by data feasibility
5. UX polish, keyboard shortcuts, preset modes
