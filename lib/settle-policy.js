/** 官方桌面启动时 Fiber._reload 还在挂 desktop-office，settle 不得解包/杀进程。 */

export const DESKTOP_SETTLE_DELAY_MS = 4000;

export function isInactiveContextError(error) {
  if (!error) return false;
  if (error.code === "INACTIVE_EFFECT") return true;
  return /inactive context/i.test(String(error.message || error));
}

export function watchContextLife(ctx) {
  const life = { alive: true };
  if (!ctx || typeof ctx.effect !== "function") return life;
  try {
    ctx.effect(() => () => {
      life.alive = false;
    });
  } catch (error) {
    if (isInactiveContextError(error)) {
      life.alive = false;
      return life;
    }
    throw error;
  }
  return life;
}

export function settleDelayMs(surface) {
  return surface === "desktop" ? DESKTOP_SETTLE_DELAY_MS : 0;
}

/** 桌面启动自愈不得 requestRestart / taskkill，否则 Cordis 会 INACTIVE_EFFECT。 */
export function settleMayRestart({ surface, sealed = false } = {}) {
  if (surface === "desktop") return false;
  if (sealed) return false;
  return true;
}

/** 密封 asar 上就地 extract/swap 会和官方 Host 的 Fiber._reload 抢锁。 */
export function settleMayReapply({ surface, sealed = false } = {}) {
  if (surface === "desktop" && sealed) return false;
  return true;
}

/**
 * 点「应用」后是否重启。网页和桌面用同一条：
 * 提示词已经写入，或这次写了补丁，就重启。对不上当前版本的代码补丁不取消重启。
 * 密封包多出来的只是换包，不另做一套判断。
 * 冷却不放在这里——否则第一次重启没换掉 asar，第二次应用会被当成取消。
 *
 * 1.7.4：**已解包的桌面不自动重启**。桌面宿主在 boot 途中被要求 shutdown 时，
 * `installDesktopUpdateTaskControl(ctx)` 会拿到已 dispose 的 ctx 并抛
 * `CordisError: cannot create effect on inactive context`，表现为
 * 「The application could not start or stopped unexpectedly」。
 * 自动重启与用户手动重启撞车就是这个框的成因，所以桌面解包后只提示重新打开，
 * 由用户自己完成那一次重启；密封包仍要自动换包（那条路径等的是退出，不是重启）。
 */
export function applyShouldRestart({
  complete = false,
  sealed = false,
  appliedCount = 0,
  promptReady = false,
  surface = "",
} = {}) {
  // 密封桌面：点「应用」后必须完全退出才能换 asar / 加载 resources/app，与补丁是否标 applied 无关。
  if (sealed) return true;
  // 已解包桌面：只写盘，不重启（见上面的 1.7.4 说明）。
  if (surface === "desktop") return false;
  if (complete || promptReady) return true;
  return Number(appliedCount) > 0;
}
