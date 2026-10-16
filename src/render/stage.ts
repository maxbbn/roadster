import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** Renderer, post-processing chain, image-based lighting and the key lights. */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly moon: THREE.DirectionalLight;
  private width = 1;
  private height = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.5, 3000);
    this.scene.fog = new THREE.FogExp2('#0a0f24', 0.0026);

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.55, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.scene.environment = this.buildEnvironment();
    this.scene.environmentIntensity = 0.9;

    const hemi = new THREE.HemisphereLight('#5b74b8', '#1a1210', 0.55);
    this.scene.add(hemi);

    this.moon = new THREE.DirectionalLight('#c6d4ff', 2.2);
    this.moon.position.set(-30, 60, 40);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(2048, 2048);
    const sc = this.moon.shadow.camera;
    sc.left = -34;
    sc.right = 34;
    sc.top = 26;
    sc.bottom = -26;
    sc.near = 1;
    sc.far = 160;
    this.moon.shadow.bias = -0.0004;
    this.moon.shadow.normalBias = 0.03;
    this.moon.shadow.radius = 3;
    this.scene.add(this.moon);
    this.scene.add(this.moon.target);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Night-time studio: dark gradient dome with a few soft light panels for paint reflections. */
  private buildEnvironment(): THREE.Texture {
    const env = new THREE.Scene();
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(50, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: {},
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying vec3 vDir; void main(){
          float h = vDir.y;
          vec3 top = vec3(0.02,0.035,0.09);
          vec3 hor = vec3(0.16,0.12,0.22);
          vec3 low = vec3(0.03,0.025,0.03);
          vec3 c = h > 0.0 ? mix(hor, top, pow(h, 0.6)) : mix(hor, low, pow(-h, 0.4));
          c += vec3(1.0,0.45,0.2) * pow(max(0.0, 1.0 - abs(h) * 6.0), 3.0) * 0.6;
          gl_FragColor = vec4(c, 1.0);
        }`,
      }),
    );
    env.add(dome);
    const panel = (w: number, h: number, color: THREE.Color, pos: THREE.Vector3) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
      m.position.copy(pos);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    panel(40, 6, new THREE.Color(2.2, 2.4, 2.8), new THREE.Vector3(0, 30, 10));
    panel(30, 3, new THREE.Color(1.6, 1.8, 2.4), new THREE.Vector3(-10, 25, -20));
    panel(8, 30, new THREE.Color(0.2, 1.4, 1.8), new THREE.Vector3(-35, 6, 15));
    panel(8, 30, new THREE.Color(2.0, 0.6, 0.3), new THREE.Vector3(35, 4, -10));
    panel(60, 2, new THREE.Color(1.2, 1.1, 1.0), new THREE.Vector3(0, 4, 40));
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const tex = pmrem.fromScene(env, 0.03).texture;
    pmrem.dispose();
    return tex;
  }

  resize(): void {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    const pr = this.renderer.getPixelRatio();
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(this.width, this.height);
    this.bloom.resolution.set(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  get viewportHeight(): number {
    return this.height * this.renderer.getPixelRatio();
  }

  /** Keep the shadow frustum centred on the action. */
  followShadow(x: number, y: number): void {
    const snap = 0.5;
    const sx = Math.round(x / snap) * snap;
    const sy = Math.round(y / snap) * snap;
    this.moon.position.set(sx - 30, sy + 60, 40);
    this.moon.target.position.set(sx, sy, 0);
  }

  render(): void {
    this.composer.render();
  }
}
