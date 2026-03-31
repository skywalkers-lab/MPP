import express from 'express';
import { StateReducer } from '../agent/StateReducer';

import path from 'path';

export function startDebugHttpServer(reducer: StateReducer, port = 3000) {
  const app = express();

  // 정적 파일 서빙: /dashboard, /public
  const publicDir = path.join(process.cwd(), 'public');
  app.use('/public', express.static(publicDir));
  app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(publicDir, 'dashboard.html'));
  });

  // 상태 엔드포인트
  app.get('/state', (req, res) => {
    const state = reducer.getState();
    const player = state.playerCarIndex != null ? state.cars[state.playerCarIndex] : null;
    const safe = (v: any) => v == null ? null : v;
    res.json({
      session: {
        sessionUID: state.sessionMeta?.sessionUID ?? null,
        sessionType: state.sessionMeta?.sessionType ?? null,
        trackId: state.sessionMeta?.trackId ?? null,
        totalLaps: state.sessionMeta?.totalLaps ?? null,
        sessionTime: state.sessionMeta?.sessionTime ?? null,
      },
      player: {
        carIndex: state.playerCarIndex ?? null,
        position: safe(player?.position),
        currentLapNum: safe(player?.currentLapNum),
        pitStatus: safe(player?.pitStatus),
        tyreCompound: safe(player?.tyreCompound),
        tyreAgeLaps: safe(player?.tyreAgeLaps),
        fuelLapsRemaining: safe(player?.fuelLapsRemaining),
        frontWingLeftDamage: safe(player?.damage?.frontWingLeft),
        frontWingRightDamage: safe(player?.damage?.frontWingRight),
        rearWingDamage: safe(player?.damage?.rearWing),
        driverName: state.drivers[state.playerCarIndex ?? -1]?.driverName ?? null,
      },
      totalCars: Object.keys(state.cars).length,
      recentEvents: state.eventLog.slice(-10),
      raw: state,
    });
  });

  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[Debug] HTTP server running at http://localhost:${port}/dashboard`);
  });
}
