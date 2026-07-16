// 3D Earth — Three.js globe with NASA Blue Marble, drifting cloud layer,
// atmosphere glow, starfield, and live earthquakes as pulsing markers.
// Drag to spin, wheel to zoom; it breathes on its own when idle.
import { onCleanup, onMount } from "solid-js";
import * as THREE from "three";
import gsap from "gsap";
import type { Quake } from "../apps";

export interface GlobeApi {
  /** Animate the globe to face a lat/lon and drop a pulsing pin there. */
  flyTo: (lat: number, lon: number, color?: number) => void;
  /** Fly to the strongest quake of the day; returns its description. */
  spotlightQuake: () => string | null;
  /** Place/update the ISS marker (it leaves an orbit trail). */
  setIss: (lat: number, lon: number) => void;
  /** Zoom in (+1) or out (−1) — same smooth path as the scroll wheel. */
  zoom: (dir: 1 | -1) => void;
}

const ATMO_VERT = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const ATMO_FRAG = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    float glow = pow(0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.6);
    gl_FragColor = vec4(0.35, 0.6, 1.0, 1.0) * glow;
  }
`;

export default function Globe(props: { quakes: Quake[]; bind?: (api: GlobeApi) => void }) {
  let canvas!: HTMLCanvasElement;

  onMount(() => {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    const size = () => {
      const r = canvas.parentElement!.getBoundingClientRect();
      renderer.setSize(r.width, r.height);
      camera.aspect = r.width / r.height;
      camera.updateProjectionMatrix();
    };
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0.6, 26); // far out — we fly in

    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(4, 2, 6);
    scene.add(sun, new THREE.AmbientLight(0xaabbdd, 1.05));

    const tl = new THREE.TextureLoader();
    const globe = new THREE.Group();

    // 8K NASA-derived surface (Solar System Scope, CC BY 4.0) where the GPU
    // allows; anisotropic filtering keeps it sharp at glancing angles
    const maxTex = renderer.capabilities.maxTextureSize;
    const aniso = renderer.capabilities.getMaxAnisotropy();
    const earthTex = tl.load(maxTex >= 8192 ? "/textures/earth-8k.jpg" : "/textures/earth.jpg");
    earthTex.colorSpace = THREE.SRGBColorSpace;
    earthTex.anisotropy = aniso;
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(3, 128, 128),
      new THREE.MeshStandardMaterial({ map: earthTex, roughness: 0.9, metalness: 0 }),
    );
    globe.add(earth);

    const cloudTex = tl.load("/textures/clouds-2k.jpg"); // white-on-black → alpha
    cloudTex.anisotropy = aniso;
    const clouds = new THREE.Mesh(
      new THREE.SphereGeometry(3.035, 96, 96),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        alphaMap: cloudTex,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
      }),
    );
    globe.add(clouds);

    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(3.35, 64, 64),
      new THREE.ShaderMaterial({
        vertexShader: ATMO_VERT,
        fragmentShader: ATMO_FRAG,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
      }),
    );
    globe.add(atmo);

    // live quakes as pulsing beacons (bigger + halo ring so they read from orbit)
    const latLonToVec = (latDeg: number, lonDeg: number, r: number) => {
      const lat = (latDeg * Math.PI) / 180, lon = (lonDeg * Math.PI) / 180;
      return new THREE.Vector3(
        r * Math.cos(lat) * Math.cos(lon),
        r * Math.sin(lat),
        -r * Math.cos(lat) * Math.sin(lon),
      );
    };
    const beacons: THREE.Mesh[] = [];
    for (const q of props.quakes) {
      const pos = latLonToVec(q.lat, q.lon, 3.03);
      const b = new THREE.Mesh(
        new THREE.SphereGeometry(0.03 + q.mag * 0.016, 8, 8),
        new THREE.MeshBasicMaterial({ color: q.mag >= 5 ? 0xff4a4a : 0xffb04a, transparent: true }),
      );
      b.position.copy(pos);
      b.userData.phase = Math.random() * Math.PI * 2;
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.05 + q.mag * 0.02, 0.065 + q.mag * 0.024, 24),
        new THREE.MeshBasicMaterial({ color: q.mag >= 5 ? 0xff4a4a : 0xffb04a, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
      );
      halo.position.copy(pos.clone().multiplyScalar(1.004));
      halo.lookAt(pos.clone().multiplyScalar(2));
      globe.add(b, halo);
      beacons.push(b);
    }

    // the station — a warm dot with an orbit trail, riding above the clouds
    const issDot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
    const issGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    issDot.add(issGlow);
    issDot.visible = false;
    const issTrailPts: THREE.Vector3[] = [];
    const issTrailGeo = new THREE.BufferGeometry();
    const issTrail = new THREE.Line(issTrailGeo, new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.45 }));
    globe.add(issDot, issTrail);

    // the "you are here / searched place" pin
    const pin = new THREE.Group();
    const pinDot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), new THREE.MeshBasicMaterial({ color: 0x5dff8a }));
    const pinRing = new THREE.Mesh(
      new THREE.RingGeometry(0.09, 0.115, 32),
      new THREE.MeshBasicMaterial({ color: 0x5dff8a, transparent: true, side: THREE.DoubleSide }),
    );
    pin.add(pinDot, pinRing);
    pin.visible = false;
    globe.add(pin);

    scene.add(globe);

    // —— imperative API for the console's buttons ——
    const faceRotation = (latDeg: number, lonDeg: number) => ({
      x: (latDeg * Math.PI) / 180,
      y: -Math.PI / 2 - (lonDeg * Math.PI) / 180,
    });
    const flyTo = (latDeg: number, lonDeg: number, color = 0x5dff8a) => {
      const pos = latLonToVec(latDeg, lonDeg, 3.04);
      pin.position.copy(pos);
      pinRing.lookAt(pos.clone().multiplyScalar(2));
      (pinDot.material as THREE.MeshBasicMaterial).color.setHex(color);
      (pinRing.material as THREE.MeshBasicMaterial).color.setHex(color);
      pin.visible = true;
      const target = faceRotation(latDeg, lonDeg);
      vx = 0; vy = 0; // stop the idle drift while we travel
      gsap.to(globe.rotation, { x: target.x, y: target.y, duration: 1.8, ease: "power2.inOut" });
      zTarget = Math.min(zTarget, 5.6);
      gsap.to(camera.position, { y: 0.1, duration: 1.8, ease: "power2.inOut" });
    };
    props.bind?.({
      flyTo,
      spotlightQuake: () => {
        if (!props.quakes.length) return null;
        const big = [...props.quakes].sort((a, b) => b.mag - a.mag)[0];
        flyTo(big.lat, big.lon, big.mag >= 5 ? 0xff4a4a : 0xffb04a);
        return `M${big.mag.toFixed(1)} — ${big.place}`;
      },
      setIss: (lat, lon) => {
        issDot.position.copy(latLonToVec(lat, lon, 3.22)); // orbit height, above clouds
        issDot.visible = true;
        issTrailPts.push(issDot.position.clone());
        if (issTrailPts.length > 60) issTrailPts.shift();
        issTrailGeo.setFromPoints(issTrailPts);
      },
      zoom: (dir) => {
        zTarget = THREE.MathUtils.clamp(zTarget - dir * 1.1, Z_MIN, Z_MAX);
      },
    });

    // starfield
    const N = 900;
    const sp = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) sp[i] = (Math.random() - 0.5) * 90;
    scene.add(new THREE.Points(
      new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(sp, 3)),
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.08, transparent: true, opacity: 0.7, depthWrite: false }),
    ));

    // zoom: smooth lerp toward a target — Z_MIN hovers just over the clouds,
    // where the 8K surface still holds up
    const Z_MIN = 3.6, Z_MAX = 16;
    let zTarget = 8.6;

    // fly in — the "proper animation"; rest facing India (77°E)
    const restY = -Math.PI / 2 - (77 * Math.PI) / 180;
    globe.rotation.y = restY;
    gsap.to(camera.position, { y: 0.2, duration: 2.4, ease: "power3.out" });
    gsap.from(globe.rotation, { y: restY - 2.4, duration: 2.4, ease: "power3.out" });

    // drag to spin (slower when zoomed in), wheel/pinch to zoom
    const zoomFactor = () => (camera.position.z - 3.0) / 5.6; // 1 at start, →0.1 up close
    let dragging = false, lx = 0, ly = 0, vx = 0.0016, vy = 0;
    const down = (e: PointerEvent) => { dragging = true; lx = e.clientX; ly = e.clientY; };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const f = zoomFactor();
      vx = (e.clientX - lx) * 0.00028 * f;
      vy = (e.clientY - ly) * 0.00022 * f;
      globe.rotation.y += (e.clientX - lx) * 0.005 * f;
      globe.rotation.x = THREE.MathUtils.clamp(globe.rotation.x + (e.clientY - ly) * 0.004 * f, -1.1, 1.1);
      lx = e.clientX; ly = e.clientY;
    };
    const up = () => (dragging = false);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zTarget = THREE.MathUtils.clamp(zTarget + e.deltaY * 0.02 * Math.max(zoomFactor(), 0.25), Z_MIN, Z_MAX);
    };
    canvas.addEventListener("pointerdown", down);
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    canvas.addEventListener("wheel", wheel, { passive: false });

    let disposed = false;
    let last = performance.now();
    let t = 0;
    const render = (now: number) => {
      if (disposed) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      t += dt;
      if (!dragging && !gsap.isTweening(globe.rotation)) {
        globe.rotation.y += vx;
        globe.rotation.x = THREE.MathUtils.clamp(globe.rotation.x + vy, -1.5, 1.5);
        vx += (0.0016 * zoomFactor() - vx) * 0.02; // idle spin slows up close
        vy *= 0.95;
      }
      camera.position.z += (zTarget - camera.position.z) * 0.07; // smooth zoom
      clouds.rotation.y += dt * 0.0065; // clouds drift over the surface
      for (const b of beacons) {
        const s2 = 1 + 0.45 * Math.sin(t * 3 + b.userData.phase);
        b.scale.setScalar(s2);
        (b.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.45 * Math.sin(t * 3 + b.userData.phase);
      }
      if (pin.visible) pinRing.scale.setScalar(1 + 0.35 * Math.sin(t * 4));
      renderer.render(scene, camera);
      requestAnimationFrame(render);
    };
    size();
    requestAnimationFrame(render);
    addEventListener("resize", size);

    onCleanup(() => {
      disposed = true;
      removeEventListener("resize", size);
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      renderer.dispose();
    });
  });

  return <canvas class="globe-canvas" ref={canvas} />;
}
