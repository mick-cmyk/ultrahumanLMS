declare module 'player.js' {
  export class Player {
    constructor(element: HTMLIFrameElement | string);
    on(event: 'ready' | 'play' | 'pause' | 'ended', callback: () => void): void;
    on(
      event: 'timeupdate',
      callback: (data: { seconds: number; duration: number }) => void
    ): void;
    off(event: string, callback?: (...args: unknown[]) => void): void;
  }
}
