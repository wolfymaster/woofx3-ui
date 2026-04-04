declare module "lottie-web" {
  interface AnimationItem {
    addEventListener(eventName: string, callback: () => void): void;
    removeEventListener(eventName: string, callback: () => void): void;
    play(): void;
    pause(): void;
    stop(): void;
    destroy(): void;
    isPaused: boolean;
    totalFrames: number;
    currentFrame: number;
  }

  interface LoadAnimationOptions {
    container: Element;
    renderer?: "svg" | "canvas" | "html";
    loop?: boolean;
    autoplay?: boolean;
    animationData?: object;
    path?: string;
    rendererSettings?: object;
  }

  interface Lottie {
    loadAnimation(options: LoadAnimationOptions): AnimationItem;
    play(name?: string): void;
    pause(name?: string): void;
    stop(name?: string): void;
    setSpeed(speed: number, name?: string): void;
    setDirection(direction: 1 | -1, name?: string): void;
    searchAnimation(element: string | Element, showWarning?: boolean): AnimationItem[];
    destroy(name?: string): void;
    registerAnimation(element: Element, animation: AnimationItem): void;
    getRegisteredAnimations(): AnimationItem[];
  }

  const lottie: Lottie;
  export default lottie;
}
