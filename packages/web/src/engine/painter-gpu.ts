import { Sprite, Texture } from 'pixi.js';
import { BufferPainter } from './painter.js';

/**
 * A procedural layer: draw with `painter` (Painter API) each frame, call `flush()` to upload.
 * The sprite sits at (0,0) of its parent and is `width×height` logical pixels.
 */
export class PainterLayer {
  readonly painter: BufferPainter;
  readonly sprite: Sprite;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  private tex: Texture;

  constructor(width: number, height: number) {
    this.painter = new BufferPainter(width, height);
    this.canvas = document.createElement('canvas');
    this.canvas.width = width; this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(width, height);
    this.tex = Texture.from(this.canvas);
    this.tex.source.scaleMode = 'nearest';
    this.sprite = new Sprite(this.tex);
  }

  /** Uploads the buffer to the GPU if anything was drawn since the last flush. */
  flush(): void {
    const p = this.painter;
    if (!p.dirty) return;
    this.img.data.set(p.data);
    this.ctx.putImageData(this.img, 0, 0);
    this.tex.source.update();
    p.dirty = false;
  }

  destroy(): void { this.sprite.destroy({ texture: true, textureSource: true }); }
}
