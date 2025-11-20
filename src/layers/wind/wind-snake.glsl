// Fragment shader snippet for wind snake animation
// This code is injected into LineMaterial's fragment shader via onBeforeCompile

// Uniform declarations (injected before main)
uniform float animationPhase;
uniform float snakeLength;
uniform float lineSteps;

// Fragment color calculation (replaces gl_FragColor assignment)
// Input: diffuseColor contains (normalizedIndex, normalizedOffset, taperFactor)
// Output: Animated snake effect with opacity based on position relative to snake head

float normalizedIndex = diffuseColor.r;
float normalizedOffset = diffuseColor.g;
float taperFactor = diffuseColor.b;

float cycleLength = lineSteps + snakeLength;
float segmentIndex = normalizedIndex * (lineSteps - 1.0);
float randomOffset = normalizedOffset * cycleLength;
float snakeHead = mod(animationPhase + randomOffset, cycleLength);
float distanceFromHead = segmentIndex - snakeHead;

if (distanceFromHead < -snakeLength) {
  distanceFromHead += cycleLength;
}

float segmentOpacity = 0.0;
if (distanceFromHead >= -snakeLength && distanceFromHead <= 0.0) {
  float positionInSnake = (distanceFromHead + snakeLength) / snakeLength;
  segmentOpacity = positionInSnake;
}

float finalAlpha = alpha * segmentOpacity * taperFactor;
gl_FragColor = vec4( vec3(1.0), finalAlpha );
