/**
 * Type declarations for troika-three-text
 *
 * Basic types for the Text class and its properties
 */

declare module 'troika-three-text' {
  import * as THREE from 'three';

  export class Text extends THREE.Mesh {
    text: string;
    font: string;
    fontSize: number;
    color: number | string;
    anchorX: 'left' | 'center' | 'right' | number;
    anchorY: 'top' | 'middle' | 'bottom' | number;
    outlineWidth: number | string;
    outlineColor: number | string;
    outlineOpacity: number;
    depthTest: boolean;
    depthWrite: boolean;

    sync(): void;
    dispose(): void;
  }
}
