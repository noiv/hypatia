

import { createRingBuffer, RingBuffer } from "./ringbuffer"

type TTask = 'update' | 'render' | 'frame' | 'fps'
type TData = {
    last: number
    stamp: number
    buffer: RingBuffer
}

export const measurements: Record<TTask, TData> = {
    update: { last: 0, stamp: 0, buffer: createRingBuffer(60) },
    render: { last: 0, stamp: 0, buffer: createRingBuffer(60) },
    frame:  { last: 0, stamp: 0, buffer: createRingBuffer(60) },
    fps:    { last: 0, stamp: 0, buffer: createRingBuffer(60) },
}

function trimMs(num: number): string {
    // Format as XX.X (4 characters: 00.0 to 99.9)
    const rounded = Math.round(num * 10) / 10;
    return rounded.toFixed(1).padStart(4, '0');
}

function trimFps(num: number): string {
    // Convert milliseconds to FPS: 1000 / ms
    // Format as XXX (3 characters: " 60" or "120")
    const fps = num > 0 ? Math.round(1000 / num) : 0;
    return fps.toString().padStart(3, ' ');
}

export function line () {

    const upd = trimMs(measurements.update.buffer.avg());
    const ren = trimMs(measurements.render.buffer.avg());
    const frm = trimMs(measurements.frame.buffer.avg());

    // Convert time between frames (ms) to FPS
    const fps = trimFps(measurements.fps.buffer.avg());

    return `upd: ${upd} ren: ${ren} frm: ${frm} fps: ${fps}`

}

export function start (task: TTask) {
    measurements[task].stamp = performance.now();
}

export function done (task: TTask) {
    measurements[task].last = performance.now() - measurements[task].stamp;
    measurements[task].buffer.push(measurements[task].last)
}
