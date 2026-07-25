// gifenc ships no types. Only the three functions the Share button uses are
// declared — a full ambient `any` module would hide real mistakes.
declare module "gifenc" {
  interface FrameOpts { palette?: number[][]; delay?: number; transparent?: boolean }
  interface Enc {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: FrameOpts): void;
    finish(): void;
    bytes(): Uint8Array;
  }
  export function GIFEncoder(): Enc;
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number): number[][];
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: number[][]): Uint8Array;
}
