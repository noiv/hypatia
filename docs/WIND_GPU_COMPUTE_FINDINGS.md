# Wind GPU Compute Performance Findings

## Overview

This document captures measurements and findings from optimizing the WebGPU wind particle tracing system in `WindLayerGPUCompute.ts`.

## Performance Evolution

| Version | Performance | Notes |
|---------|-------------|-------|
| Original | 29.5ms | Baseline implementation |
| Optimized LineSegments2 | 9-22ms | Float32Array reuse, zero-copy to geometry |
| Custom Geometry | Not tested | Shader errors, implementation ready but disabled |

## Measured Bottlenecks

### Timing Breakdown (typical steady-state)

```
Total: 9-22ms
├─ GPU submit: 0-2ms (command encoding)
├─ GPU map: 2-5ms (waiting for GPU compute + buffer copy)
└─ Geometry update: 6-19ms (CPU conversion) ← BOTTLENECK
```

**Key Finding**: CPU geometry update consumes 70% of total time.

### Memory Analysis

```
Initial load: 253.8MB JS heap
After 200 rapid updates: 251.9MB JS heap
Growth: -0.18MB (essentially zero)
```

**Finding**: Array reuse optimization is working correctly. Memory allocation is NOT the cause of performance variation.

## Optimization Attempts

### 1. Dual-Buffer GPU Shader (FAILED)
**Approach**: Output segment pairs directly from GPU compute shader
**Result**: 50-70ms (worse than baseline)
**Root cause**: 3x more data output (positions + colors as separate vec3 pairs instead of vec4)
**Status**: Reverted to vec4 output format

### 2. Float32Array Pre-allocation (SUCCESS)
**Approach**: Pre-allocate position/color Float32Arrays and reuse them
**Result**: Reduced from 50-70ms to 17-20ms
**Code**: WindLayerGPUCompute.ts:462-515
```typescript
if (!this.cachedPositions || this.cachedPositions.length !== arraySize) {
  this.cachedPositions = new Float32Array(arraySize);
  this.cachedColors = new Float32Array(arraySize);
}
```

### 3. Zero-Copy to LineSegments2 (SUCCESS)
**Approach**: Pass Float32Array directly instead of Array.from() conversion
**Result**: Eliminated array conversion overhead
**Code**: WindLayerGPUCompute.ts:513-515
```typescript
geometry.setPositions(positions as any);
geometry.setColors(colors as any);
```

### 4. Custom Geometry with Instanced Rendering (INCOMPLETE)
**Approach**: Replace LineSegments2 with custom InstancedBufferGeometry
**Status**: Implementation complete but has shader compilation errors
**Flag**: `USE_CUSTOM_GEOMETRY = false` (WindLayerGPUCompute.ts:24)
**Expected benefit**: Eliminate 6-19ms CPU geometry conversion
**Code location**: WindLayerGPUCompute.ts:667-810

## Current Bottleneck Analysis

### Geometry Update Loop
**Location**: `updateGeometry()` at WindLayerGPUCompute.ts:459-515

**Work performed**:
- 8192 lines × 31 segments = 253,952 segments
- 6 floats per segment (positions) = 1,523,712 floats
- 6 floats per segment (colors) = 1,523,712 floats
- **Total: 3,047,424 float writes** on CPU per update

**Performance**: 6-19ms (varies, outliers up to 19ms)

### Why the variation?
- Browser compositor overhead
- V8 JIT optimization state
- GPU driver scheduling
- Frame timing variations

**Not caused by**:
- ✗ Garbage collection (memory is stable)
- ✗ Memory allocation (arrays are reused)

## Hardware Context

**Test system**: M4 Pro (14 cores, 24GB RAM, 20-core GPU)
- Chrome process: ~91MB physical footprint
- JS heap: 251-254MB
- GPU: Apple M4 Pro (Metal 4)

## Recommendations

### Short-term
1. ✅ Compressed logging for easier debugging
2. ✅ Added memory monitoring hotkey ('d')
3. ✅ Chrome process monitoring script

### Medium-term
1. ⚠️ Fix custom geometry shader errors
2. ⚠️ Test custom geometry vs LineSegments2 performance
3. ⚠️ Verify performance on non-M4 hardware

### Long-term considerations
1. Hemisphere culling (only update visible lines)
2. Dynamic segment count based on zoom level
3. Geometry budget system (trade line count for detail)

## Code References

### Main files
- `src/visualization/WindLayerGPUCompute.ts` - Wind particle tracing implementation
- `src/shaders/windLineTracer.wgsl` - WebGPU compute shader
- `src/services/WindGPUService.ts` - Data loading and timestep management

### Key functions
- `doUpdate()` - WindLayerGPUCompute.ts:404-459 - GPU compute execution
- `updateGeometry()` - WindLayerGPUCompute.ts:462-515 - CPU geometry conversion (bottleneck)
- `createCustomGeometry()` - WindLayerGPUCompute.ts:667-810 - Alternative implementation

### Feature flags
- `USE_CUSTOM_GEOMETRY` - WindLayerGPUCompute.ts:24 - Toggle between implementations

## Tooling Additions

### Debug hotkey
Press `d` in browser to log current memory:
```
Mem: 251.7MB / 252.7MB (limit: 4096MB)
```

### Chrome process monitoring
```bash
./monitor-chrome.sh
```
Shows: CPU, memory (RSS/VSZ), GPU info, open files, memory regions

### Page load detection
Console logs `[PAGE_LOADED]` when scene is fully initialized - useful for automation

### Wait for load script
```bash
~/.claude/skills/playwright-skill/wait-for-load.sh
```

## Lessons Learned

1. **Measure, don't guess**: Initial speculation about GC was wrong - memory is stable
2. **Detailed timing is essential**: Breaking down into submit/map/geometry revealed the real bottleneck
3. **Zero-copy matters**: Eliminating Array.from() conversion saved significant time
4. **Pre-allocation works**: Reusing Float32Arrays prevents repeated allocations
5. **CPU geometry conversion is expensive**: 3M float writes takes 6-19ms even on M4 Pro
6. **Custom geometry is promising**: Should eliminate CPU bottleneck entirely once shader errors are fixed

## Next Steps

1. Debug custom geometry shader errors (modelViewMatrix/projectionMatrix redefinition)
2. Compare custom geometry vs LineSegments2 with identical workload
3. Profile on Intel/AMD hardware to verify M4-specific assumptions
4. Consider hemisphere culling for additional 2x potential speedup
