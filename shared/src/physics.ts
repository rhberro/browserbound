import { Projectile, ProjectileInput, GRAVITY, POWER_SCALE } from './types';

export class ProjectileSimulation {
  private position: { x: number; y: number };
  private velocity: { x: number; y: number };
  private windForce: { x: number; y: number };

  constructor(
    startX: number,
    startY: number,
    input: ProjectileInput,
    windSpeed: number,
    windDirection: number
  ) {
    this.position = { x: startX, y: startY };

    // Convert angle and power to velocity
    const speed = input.power * POWER_SCALE;
    this.velocity = {
      x: Math.cos(input.angle) * speed,
      y: -Math.sin(input.angle) * speed,
    };

    // Wind force in pixels/frame
    this.windForce = {
      x: Math.cos(windDirection) * (windSpeed * 0.05),
      y: Math.sin(windDirection) * (windSpeed * 0.05),
    };
  }

  step(deltaTime: number = 1): Projectile {
    this.velocity.y += GRAVITY;
    this.velocity.x += this.windForce.x;
    this.velocity.y += this.windForce.y;

    this.position.x += this.velocity.x * deltaTime;
    this.position.y += this.velocity.y * deltaTime;

    return {
      x: this.position.x,
      y: this.position.y,
      vx: this.velocity.x,
      vy: this.velocity.y,
    };
  }

  getPosition() {
    return { ...this.position };
  }

  getVelocity() {
    return { ...this.velocity };
  }
}

export function calculateTrajectory(
  startX: number,
  startY: number,
  input: ProjectileInput,
  windSpeed: number,
  windDirection: number,
  maxSteps: number = 1000
): Array<{ x: number; y: number }> {
  const trajectory: Array<{ x: number; y: number }> = [];
  const sim = new ProjectileSimulation(startX, startY, input, windSpeed, windDirection);

  for (let i = 0; i < maxSteps; i++) {
    const state = sim.step();
    trajectory.push({ x: state.x, y: state.y });

    if (state.y > 1000) break;
  }

  return trajectory;
}
