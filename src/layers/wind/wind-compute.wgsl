// WebGPU Compute Shader for Wind Particle Tracing
//
// Traces wind particles on a sphere surface using wind field data (U and V components)
// Implements bilinear interpolation and temporal blending between two timesteps

struct Seed {
  position: vec3f,
  padding: f32,
}

@group(0) @binding(0) var<storage, read> seeds: array<Seed>;
@group(0) @binding(1) var<storage, read_write> output: array<vec4f>;
@group(0) @binding(2) var<storage, read> windU0: array<u32>;
@group(0) @binding(3) var<storage, read> windV0: array<u32>;
@group(0) @binding(4) var<storage, read> windU1: array<u32>;
@group(0) @binding(5) var<storage, read> windV1: array<u32>;
@group(0) @binding(6) var<uniform> blend: f32;

const WIDTH: u32 = 1441u;
const HEIGHT: u32 = 721u;
const STEP_FACTOR: f32 = 0.00045;
const PI: f32 = 3.14159265359;

fn fp16ToFloat(fp16: u32) -> f32 {
  let sign = (fp16 >> 15u) & 1u;
  let exponent = (fp16 >> 10u) & 31u;
  let fraction = fp16 & 1023u;
  if (exponent == 0u) { return 0.0; }
  let signF = select(1.0, -1.0, sign == 1u);
  let expF = f32(i32(exponent) - 15);
  let fracF = f32(fraction) / 1024.0;
  return signF * pow(2.0, expF) * (1.0 + fracF);
}

fn sampleWind0(lat: f32, lon: f32) -> vec2f {
  let x = (lon + 180.0) / 0.25;
  let y = (90.0 - lat) / 0.25;
  let x0 = u32(floor(x)) % WIDTH;
  let x1 = (x0 + 1u) % WIDTH;
  let y0 = clamp(u32(floor(y)), 0u, HEIGHT - 1u);
  let y1 = clamp(y0 + 1u, 0u, HEIGHT - 1u);
  let fx = fract(x);
  let fy = fract(y);

  let idx00 = y0 * WIDTH + x0;
  let idx10 = y0 * WIDTH + x1;
  let idx01 = y1 * WIDTH + x0;
  let idx11 = y1 * WIDTH + x1;

  let u00 = fp16ToFloat(windU0[idx00]);
  let u10 = fp16ToFloat(windU0[idx10]);
  let u01 = fp16ToFloat(windU0[idx01]);
  let u11 = fp16ToFloat(windU0[idx11]);
  let v00 = fp16ToFloat(windV0[idx00]);
  let v10 = fp16ToFloat(windV0[idx10]);
  let v01 = fp16ToFloat(windV0[idx01]);
  let v11 = fp16ToFloat(windV0[idx11]);

  let u_top = mix(u00, u10, fx);
  let u_bot = mix(u01, u11, fx);
  let u = mix(u_top, u_bot, fy);
  let v_top = mix(v00, v10, fx);
  let v_bot = mix(v01, v11, fx);
  let v = mix(v_top, v_bot, fy);

  return vec2f(u, v);
}

fn sampleWind1(lat: f32, lon: f32) -> vec2f {
  let x = (lon + 180.0) / 0.25;
  let y = (90.0 - lat) / 0.25;
  let x0 = u32(floor(x)) % WIDTH;
  let x1 = (x0 + 1u) % WIDTH;
  let y0 = clamp(u32(floor(y)), 0u, HEIGHT - 1u);
  let y1 = clamp(y0 + 1u, 0u, HEIGHT - 1u);
  let fx = fract(x);
  let fy = fract(y);

  let idx00 = y0 * WIDTH + x0;
  let idx10 = y0 * WIDTH + x1;
  let idx01 = y1 * WIDTH + x0;
  let idx11 = y1 * WIDTH + x1;

  let u00 = fp16ToFloat(windU1[idx00]);
  let u10 = fp16ToFloat(windU1[idx10]);
  let u01 = fp16ToFloat(windU1[idx01]);
  let u11 = fp16ToFloat(windU1[idx11]);
  let v00 = fp16ToFloat(windV1[idx00]);
  let v10 = fp16ToFloat(windV1[idx10]);
  let v01 = fp16ToFloat(windV1[idx01]);
  let v11 = fp16ToFloat(windV1[idx11]);

  let u_top = mix(u00, u10, fx);
  let u_bot = mix(u01, u11, fx);
  let u = mix(u_top, u_bot, fy);
  let v_top = mix(v00, v10, fx);
  let v_bot = mix(v01, v11, fx);
  let v = mix(v_top, v_bot, fy);

  return vec2f(u, v);
}

fn sampleWind(lat: f32, lon: f32) -> vec2f {
  let wind0 = sampleWind0(lat, lon);
  let wind1 = sampleWind1(lat, lon);
  return mix(wind0, wind1, blend);
}

fn cartesianToLatLon(pos: vec3f) -> vec2f {
  let normalized = normalize(pos);
  let lat = asin(clamp(normalized.y, -1.0, 1.0));

  // Handle poles: at poles (|y| ≈ 1), longitude is undefined, use 0
  var lon: f32;
  if (abs(normalized.y) > 0.9999) {
    lon = 0.0; // Arbitrary longitude at poles
  } else {
    lon = atan2(normalized.z, normalized.x);
  }

  // Apply rain layer transformation (90° west rotation + horizontal mirror)
  var u = ((lon - PI/2.0) + PI) / (2.0 * PI);  // Rotate 90° west
  u = 1.0 - u;  // Mirror horizontally
  let lonDeg = u * 360.0 - 180.0;  // Convert to degrees [-180, 180]

  let latDeg = lat * 180.0 / PI;

  return vec2f(latDeg, lonDeg);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let seedIdx = global_id.x;
  if (seedIdx >= arrayLength(&seeds)) { return; }

  var pos = seeds[seedIdx].position;
  var normPos = normalize(pos);

  output[seedIdx * 32u] = vec4f(pos, 1.0);

  for (var step = 1u; step < 32u; step++) {
    let latLon = cartesianToLatLon(pos);
    let wind = sampleWind(latLon.x, latLon.y);

    let up = vec3f(0.0, 1.0, 0.0);
    var tangentX = cross(normPos, up);

    if (length(tangentX) < 0.001) {
      tangentX = cross(normPos, vec3f(1.0, 0.0, 0.0));
    }
    tangentX = normalize(tangentX);
    let tangentY = normalize(cross(tangentX, normPos));

    let windTangent = -(tangentX * wind.x - tangentY * wind.y);
    let windSpeed = length(windTangent);

    if (windSpeed < 0.001) {
      output[seedIdx * 32u + step] = vec4f(pos, 1.0);
      continue;
    }

    let axis = normalize(cross(normPos, windTangent));
    let angle = windSpeed * STEP_FACTOR;

    let cosA = cos(angle);
    let sinA = sin(angle);
    let dotVal = dot(axis, normPos);

    let rotated = normPos * cosA + cross(axis, normPos) * sinA + axis * dotVal * (1.0 - cosA);
    let newPos = normalize(rotated) * length(pos);

    let isValid = all(newPos == newPos) && length(newPos) > 0.0 && length(newPos) < 1000.0;

    if (isValid) {
      pos = newPos;
      normPos = normalize(pos);
      output[seedIdx * 32u + step] = vec4f(pos, 1.0);
    } else {
      output[seedIdx * 32u + step] = vec4f(pos, 1.0);
    }
  }
}
