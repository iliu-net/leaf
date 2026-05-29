declare module 'upng-js' {
  namespace UPNG {
    function toRGBA8(out: Uint8Array): void;
    function decode(buffer: ArrayBuffer): {
      width: number;
      height: number;
      depth: number;
      ctype: number;
      tabs: string;
      frames: ArrayBuffer[];
      data: ArrayBuffer;
    };
    function encode(
      imgs: Uint8Array[],
      w: number,
      h: number,
      cnum: number,
      dels?: number[],
    ): ArrayBuffer;
    function quantize(data: Uint8Array, psize: number): Uint8Array;
    function crc(buf: Uint8Array, off?: number, len?: number): number;
    const M4: number[];
  }
  export default UPNG;
}
