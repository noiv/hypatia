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
import type { ILayer, LayerId } from './ILayer';
import type { AnimationState } from './AnimationState';

export interface TextLabel {
  text: string;
  position: THREE.Vector3;
  color?: number;
}

/**
 * TextRenderService manages text labels in the 3D scene
 * Implements ILayer to be called last in update order
 */
export class TextRenderService implements ILayer {
  private group: THREE.Group;
  private labels: Map<string, Text[]> = new Map(); // layerId -> Text objects
  private fontSize: number;
  private fontUrl: string;

  private constructor(_layerId: LayerId) {
    this.group = new THREE.Group();
    this.group.name = 'text-labels';
    this.group.renderOrder = 2000; // Render on top of everything

    this.fontSize = TEXT_CONFIG.size.default;
    this.fontUrl = TEXT_CONFIG.font.url;

    // Pre-load font
    this.loadFont();
  }

  /**
   * Factory method to create TextRenderService
   */
  static async create(layerId: LayerId): Promise<TextRenderService> {
    return new TextRenderService(layerId);
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
   * ILayer update method - called every frame
   * Consumes state.collectedText from other layers and updates text labels
   */
  update(state: AnimationState): void {
    if (state.textEnabled) {
      // Update text service with collected labels from other layers
      // Only update if label count changed (avoid recreating every frame)
      state.collectedText.forEach((labels, layerId) => {
        const existing = this.labels.get(layerId);
        if (!existing || existing.length !== labels.length) {
          this.setLabels(layerId, labels);
        }
      });

      // Clear labels for layers that didn't submit text this frame
      const existingLayerIds = Array.from(this.labels.keys());
      for (const layerId of existingLayerIds) {
        if (!state.collectedText.has(layerId)) {
          this.clearLabels(layerId);
        }
      }
    } else {
      // Text disabled - clear all labels
      const existingLayerIds = Array.from(this.labels.keys());
      for (const layerId of existingLayerIds) {
        this.clearLabels(layerId);
      }
    }

    // Update text rendering (billboard, culling, distance scaling)
    this.updateTextRendering(state.camera.position, state.camera.quaternion);
  }

  /**
   * Update text rendering based on camera
   * - Apply billboard behavior (face camera)
   * - Apply culling (hide labels behind globe)
   * - Scale each label's fontSize based on its distance from camera
   */
  private updateTextRendering(cameraPos: THREE.Vector3, cameraQuaternion: THREE.Quaternion): void {
    const referenceDistance = 3.0; // Reference viewing distance

    // Update all labels
    for (const textObjects of this.labels.values()) {
      for (const text of textObjects) {
        // Billboard: make text face camera
        if (TEXT_CONFIG.billboard.enabled) {
          text.quaternion.copy(cameraQuaternion);
        }

        // Calculate distance from camera to THIS specific label
        const labelPos = text.position;
        const distanceToLabel = cameraPos.distanceTo(labelPos);

        // Scale fontSize based on distance to maintain constant screen size
        // Labels farther from camera need larger fontSize to appear same size
        const scaledFontSize = this.fontSize * (distanceToLabel / referenceDistance);
        text.fontSize = scaledFontSize;
        text.sync();

        // Culling: hide labels behind globe
        if (TEXT_CONFIG.performance.frustumCulling) {
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
   * Set layer visibility (ILayer interface)
   */
  setVisible(visible: boolean): void {
    this.group.visible = visible;
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
   * Get layer configuration
   */
  getConfig() {
    return TEXT_CONFIG;
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
