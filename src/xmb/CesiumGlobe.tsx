// Real tiled 3D Earth — CesiumJS with keyless Esri World Imagery draped on the
// globe (the same public tile service our old flat dive used). Streams sharper
// tiles onto the sphere as the camera descends: a true Google-Earth dive, no
// flat-map cut, no blur. Lazy-loaded so Cesium's weight never touches boot.
import { onCleanup, onMount } from "solid-js";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import type { Quake } from "../apps";

// Cesium fetches its workers/assets relative to this (we copied them to public/)
(window as any).CESIUM_BASE_URL = "/cesium/";

export interface GlobeApi {
  /** Ease the camera to look down at a place from orbit; drops a colored pin. */
  flyTo: (lat: number, lon: number, color?: number) => void;
  /** Cinematic tilted descent to street level — the Google-Earth dive. */
  diveTo: (lat: number, lon: number) => void;
  /** Rise back to orbit height over the current spot. */
  pullUp: () => void;
  /** Fly to the strongest quake of the day; returns its description. */
  spotlightQuake: () => string | null;
  /** Place/update the ISS marker at orbit height. */
  setIss: (lat: number, lon: number) => void;
  /** Zoom in (+1) / out (−1). */
  zoom: (dir: 1 | -1) => void;
}

const C3 = Cesium.Cartesian3.fromDegrees;

export default function CesiumGlobe(props: { quakes: Quake[]; bind?: (api: GlobeApi) => void }) {
  let host!: HTMLDivElement;

  onMount(() => {
    // keyless: point straight at the public ArcGIS World Imagery MapServer.
    // Passing baseLayer stops Cesium from reaching for its ion default imagery.
    const viewer = new Cesium.Viewer(host, {
      baseLayer: Cesium.ImageryLayer.fromProviderAsync(
        Cesium.ArcGisMapServerImageryProvider.fromUrl(
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
        ),
        {},
      ),
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
    });
    // strip the default UI cruft we can't turn off via options
    viewer.scene.globe.enableLighting = false;
    (viewer as any)._cesiumWidget.creditContainer.style.display = "none"; // credit shown in our bar instead
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
    viewer.scene.fog.enabled = true;

    // start high over India, gently rotating feel
    viewer.camera.setView({ destination: C3(78, 20, 14_000_000) });

    // —— pin for search / where-am-I / quake spotlight ——
    let pin: Cesium.Entity | null = null;
    const setPin = (lat: number, lon: number, hex: number) => {
      const color = Cesium.Color.fromCssColorString("#" + hex.toString(16).padStart(6, "0"));
      if (pin) viewer.entities.remove(pin);
      pin = viewer.entities.add({
        position: C3(lon, lat),
        point: { pixelSize: 14, color, outlineColor: Cesium.Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      });
    };

    // —— live quakes as pulsing points ——
    let phase = 0;
    viewer.clock.onTick.addEventListener(() => { phase += 0.05; });
    for (const q of props.quakes) {
      const strong = q.mag >= 5;
      viewer.entities.add({
        position: C3(q.lon, q.lat),
        point: {
          color: strong ? Cesium.Color.fromCssColorString("#ff4a4a") : Cesium.Color.fromCssColorString("#ffb04a"),
          outlineColor: Cesium.Color.WHITE, outlineWidth: 1,
          pixelSize: new Cesium.CallbackProperty(() => (6 + q.mag * 2) * (1 + 0.35 * Math.sin(phase + q.lat)), false) as any,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }

    // —— the ISS: a point + label riding at orbit height, with a fading trail ——
    let issEnt: Cesium.Entity | null = null;
    const trail: Cesium.Cartesian3[] = [];
    viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => trail, false) as any,
        width: 2,
        material: Cesium.Color.fromCssColorString("#ffe08a").withAlpha(0.5),
        arcType: Cesium.ArcType.NONE,
      },
    });

    const flyTo = (lat: number, lon: number, color = 0x9fd0ff) => {
      setPin(lat, lon, color);
      viewer.camera.flyTo({ destination: C3(lon, lat, 2_200_000), duration: 1.8 });
    };
    const diveTo = (lat: number, lon: number) => {
      setPin(lat, lon, 0x9fd0ff);
      viewer.camera.flyTo({
        destination: C3(lon, lat - 0.05, 1400), // just south so the tilt looks "into" the city
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-32), roll: 0 },
        duration: 4.5,
      });
    };
    const pullUp = () => {
      const c = viewer.camera.positionCartographic;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, 3_000_000),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
        duration: 1.8,
      });
    };

    props.bind?.({
      flyTo,
      diveTo,
      pullUp,
      spotlightQuake: () => {
        if (!props.quakes.length) return null;
        const big = [...props.quakes].sort((a, b) => b.mag - a.mag)[0];
        flyTo(big.lat, big.lon, big.mag >= 5 ? 0xff4a4a : 0xffb04a);
        return `M${big.mag.toFixed(1)} — ${big.place}`;
      },
      setIss: (lat, lon) => {
        const pos = C3(lon, lat, 420_000);
        if (!issEnt) {
          issEnt = viewer.entities.add({
            position: pos,
            point: { pixelSize: 10, color: Cesium.Color.fromCssColorString("#ffe08a"), outlineColor: Cesium.Color.WHITE, outlineWidth: 1, disableDepthTestDistance: Number.POSITIVE_INFINITY },
            label: { text: "ISS", font: "12px sans-serif", fillColor: Cesium.Color.fromCssColorString("#ffe08a"), pixelOffset: new Cesium.Cartesian2(0, -18), disableDepthTestDistance: Number.POSITIVE_INFINITY },
          });
        } else {
          issEnt.position = new Cesium.ConstantPositionProperty(pos) as any;
        }
        trail.push(pos);
        if (trail.length > 60) trail.shift();
      },
      zoom: (dir) => {
        const h = viewer.camera.positionCartographic.height;
        if (dir === 1) viewer.camera.zoomIn(h * 0.4);
        else viewer.camera.zoomOut(h * 0.6);
      },
    });

    onCleanup(() => { if (!viewer.isDestroyed()) viewer.destroy(); });
  });

  return <div class="cesium-host" ref={host} />;
}
