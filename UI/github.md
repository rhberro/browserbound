repo: rhberro/browserbound
branch: master

## Last sync
date: 2026-09-02T17:25:05Z

### Updated in this project
- Re-read the repo after the user's push: WindManager implemented (wind per round), WeaponConfigAdapter, MessageValidationAdapter, client split into Input/Camera/Renderer adapters.
- Rewrote the plan as `Plano de Implementacao v2.dc.html` — scope limited to UI over existing gameplay; unbuilt features moved to a separate scope.
- Flagged two client defects the HUD depends on (duplicate `onMessage` registration; own aim angle read from server echo).

## Sync history
- 2026-09-02T17:21:17Z — first read of client/server/shared; wrote v1 of the plan and the HUD mock.

## Screen map
| Project screen | Repo files |
| --- | --- |
| Match HUD.dc.html (2a Turn Queue) | client/src/adapters/RendererAdapter.ts, client/src/adapters/InputAdapter.ts, client/src/gameState.ts, client/index.html |
| Plano de Implementacao v2.dc.html | server/src/rooms/GameRoom.ts, server/src/adapters/WindManager.ts, shared/src/adapters/WeaponConfigAdapter.ts, shared/src/adapters/MessageValidationAdapter.ts, client/src/scenes/GameScene.ts, CONTEXT.md |
| Plano de Implementacao.dc.html (v1, superseded) | — |
