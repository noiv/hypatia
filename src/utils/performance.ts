

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

function trim(num: number): string {
    return ('0000' + Math.round(num * 10) / 10).slice(-4);
}

export function line () {

    const upd = trim(measurements.update.buffer.avg());
    const ren = trim(measurements.render.buffer.avg());
    const frm = trim(measurements.frame.buffer.avg());

    // needs fps/second tramsform
    const fps = trim(measurements.fps.buffer.avg());
    
    return `upd: ${upd} ren: ${ren} frm: ${frm} fps: ${fps}`

}

export function start (task: TTask) {
    measurements[task].stamp = performance.now();
}

export function done (task: TTask) {
    measurements[task].last = performance.now() - measurements[task].stamp;
    measurements[task].buffer.push(measurements[task].last)
}
