export type ScheduledTask = {
  readonly cancel: () => void;
};

export interface TimerScheduler {
  scheduleRepeating(callback: () => void, intervalMs: number): ScheduledTask;
}

export class NodeTimerScheduler implements TimerScheduler {
  public scheduleRepeating(callback: () => void, intervalMs: number): ScheduledTask {
    const timer = setInterval(callback, intervalMs);
    timer.unref();

    return {
      cancel: () => clearInterval(timer)
    };
  }
}
