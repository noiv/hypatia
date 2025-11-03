/**
 * Text Rendering Service
 *
 * Manages 3D text labels using troika-three-text
 * Features:
 * - Billboard behavior (always face camera)
 * - Constant screen size (no perspective)
 * - Behind-globe culling (dot product test)
 * - Font loading and caching
 * - Keyboard shortcuts for size adjustment
 */

import * as THREE from 'three';
import { Text } from 'troika-three-text';
import { TEXT_CONFIG } from '../config/text.config';

export interface TextLabel {
  text: string;
  position: THREE.Vector3;
  color?: number;
}

/**
 * TextRenderService manages text labels in the 3D scene
 */
export class TextRenderService {
  private group: THREE.Group;
  private labels: Map<string, Text[]> = new Map(); // layerId -> Text objects
  private fontSize: number;
  private fontUrl: string;

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'text-labels';
    this.group.renderOrder = 2000; // Render on top of everything

    this.fontSize = TEXT_CONFIG.size.default;
    this.fontUrl = TEXT_CONFIG.font.url;

    // Pre-load font
    this.loadFont();
  }

  /**
   * Load font file
   */
  private async loadFont(): Promise<void> {
    try {
      // Font loading is handled by troika-three-text automatically
      // We just need to trigger it by creating a dummy text object
      const dummy = new Text();
      dummy.font = this.fontUrl;
      dummy.sync(); // Trigger font load
      console.log('TextRenderService: Font loaded');
    } catch (error) {
      console.error('TextRenderService: Font load error', error);
    }
  }

  /**
   * Set labels for a layer
   */
  setLabels(layerId: string, labels: TextLabel[]): void {
    // Remove existing labels for this layer
    this.clearLabels(layerId);

    // Create new labels
    const textObjects: Text[] = [];
    for (const label of labels) {
      const text = this.createTextObject(label);
      textObjects.push(text);
      this.group.add(text);
    }

    this.labels.set(layerId, textObjects);
  }

  /**
   * Clear labels for a layer
   */
  clearLabels(layerId: string): void {
    const existing = this.labels.get(layerId);
    if (existing) {
      for (const text of existing) {
        this.group.remove(text);
        text.dispose();
      }
      this.labels.delete(layerId);
    }
  }

  /**
   * Create a text object
   */
  private createTextObject(label: TextLabel): Text {
    const text = new Text();

    // Text properties
    text.text = label.text;
    text.font = this.fontUrl;
    text.fontSize = this.fontSize;
    text.color = label.color ?? TEXT_CONFIG.color.default;

    // Outline for readability
    if (TEXT_CONFIG.outline.enabled) {
      text.outlineWidth = TEXT_CONFIG.outline.width;
      text.outlineColor = TEXT_CONFIG.outline.color;
      text.outlineOpacity = TEXT_CONFIG.outline.opacity;
    }

    // Position
    text.position.copy(label.position);

    // Anchoring (center)
    text.anchorX = 'center';
    text.anchorY = 'middle';

    // Material settings for billboard behavior
    text.depthTest = true;
    text.depthWrite = false;

    // Constant screen size (no perspective scaling)
    text.sizeAttenuation = TEXT_CONFIG.billboard.sizeAttenuation;

    // Sync to apply settings
    text.sync();

    return text;
  }

  /**
   * Update text rendering based on camera
   * - Apply billboard behavior (face camera)
   * - Apply culling (hide labels behind globe)
   */
  update(camera: THREE.Camera): void {
    // Get camera position
    const cameraPos = camera.position;

    // Update all labels
    for (const textObjects of this.labels.values()) {
      for (const text of textObjects) {
        // Billboard: make text face camera
        if (TEXT_CONFIG.billboard.enabled) {
          text.quaternion.copy(camera.quaternion);
        }

        // Culling: hide labels behind globe
        if (TEXT_CONFIG.performance.frustumCulling) {
          const labelPos = text.position;
          const labelDir = labelPos.clone().normalize();
          const cameraDir = cameraPos.clone().normalize();

          // Dot product: positive = facing camera, negative = behind globe
          const dot = labelDir.dot(cameraDir);
          text.visible = dot > TEXT_CONFIG.performance.cullDotThreshold;
        }
      }
    }
  }

  /**
   * Increase font size
   */
  increaseFontSize(): void {
    this.fontSize = Math.min(this.fontSize + TEXT_CONFIG.size.step, TEXT_CONFIG.size.max);
    this.updateFontSize();
  }

  /**
   * Decrease font size
   */
  decreaseFontSize(): void {
    this.fontSize = Math.max(this.fontSize - TEXT_CONFIG.size.step, TEXT_CONFIG.size.min);
    this.updateFontSize();
  }

  /**
   * Reset font size to default
   */
  resetFontSize(): void {
    this.fontSize = TEXT_CONFIG.size.default;
    this.updateFontSize();
  }

  /**
   * Update font size for all labels
   */
  private updateFontSize(): void {
    for (const textObjects of this.labels.values()) {
      for (const text of textObjects) {
        text.fontSize = this.fontSize;
        text.sync();
      }
    }
  }

  /**
   * Get the THREE.js group
   */
  getSceneObject(): THREE.Group {
    return this.group;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    // Clear all labels
    for (const layerId of Array.from(this.labels.keys())) {
      this.clearLabels(layerId);
    }

    this.labels.clear();
  }
}
