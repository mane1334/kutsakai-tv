// components/ui/shader-animation.tsx
"use client"

import { useEffect, useRef, useState } from "react"

export type ShaderAnimationProps = {
  /** Animation speed multiplier (1 = default). */
  speed?: number
  /** Glow line thickness (default 0.002). */
  lineWidth?: number
  /** Chromatic separation for the full-spectrum look. Ignored when `tint` is set. */
  dispersion?: number
  /** Monochrome tint as [r,g,b] in 0–1. Omit for the full-spectrum default. */
  tint?: [number, number, number] | null
  /** Overall brightness multiplier (default 1). */
  brightness?: number
  className?: string
  style?: React.CSSProperties
}

export function ShaderAnimation({
  speed = 1,
  lineWidth = 0.002,
  dispersion = 0.01,
  tint = null,
  brightness = 1,
  className = "w-full h-screen",
  style,
}: ShaderAnimationProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cleanup = useRef<(() => void) | null>(null)
  // TVs e browsers antigos muitas vezes não têm WebGL2 (ou bloqueiam o GPU):
  // sem este escape, a homepage rebenta com "application error".
  const [glOK, setGlOK] = useState<boolean | null>(null)

  useEffect(() => {
    try {
      const probe = document.createElement("canvas").getContext("webgl2");
      setGlOK(!!probe);
    } catch {
      setGlOK(false);
    }
  }, [])

  useEffect(() => {
    if (glOK !== true) return;
    const container = containerRef.current
    if (!container) return
    let cancelled = false;

    (async () => {
      // import dinâmico: se o three falhar neste browser, cai no fallback
      // em vez de matar a página inteira.
      let THREE: any;
      try {
        THREE = await import("three");
      } catch {
        setGlOK(false);
        return;
      }
      if (cancelled) return;

    const vertexShader = `
      void main() { gl_Position = vec4(position, 1.0); }
    `

    const fragmentShader = `
      precision highp float;
      uniform vec2 resolution;
      uniform float time;
      uniform float uLineWidth;
      uniform float uDispersion;
      uniform vec3 uTint;
      uniform float uUseTint;
      uniform float uBrightness;

      void main(void) {
        vec2 uv = (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);
        float t = time * 0.05;
        vec3 color = vec3(0.0);
        for (int j = 0; j < 3; j++) {
          for (int i = 0; i < 5; i++) {
            color[j] += uLineWidth * float(i * i) /
              abs(fract(t - uDispersion * float(j) + float(i) * 0.01) * 5.0
                  - length(uv) + mod(uv.x + uv.y, 0.2));
          }
        }
        float mono = (color.r + color.g + color.b) / 3.0;
        vec3 finalColor = mix(color, mono * uTint, uUseTint);
        gl_FragColor = vec4(finalColor * uBrightness, 1.0);
      }
    `

    const camera = new THREE.Camera()
    camera.position.z = 1

    const scene = new THREE.Scene()
    const geometry = new THREE.PlaneGeometry(2, 2)

    const uniforms = {
      time: { value: 1.0 },
      resolution: { value: new THREE.Vector2() },
      uLineWidth: { value: lineWidth },
      uDispersion: { value: dispersion },
      uTint: { value: new THREE.Vector3(...(tint ?? [1, 1, 1])) },
      uUseTint: { value: tint ? 1.0 : 0.0 },
      uBrightness: { value: brightness },
    }

    const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader })
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    let renderer: any;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true })
    } catch {
      setGlOK(false);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)

    const onResize = () => {
      renderer.setSize(container.clientWidth, container.clientHeight)
      uniforms.resolution.value.x = renderer.domElement.width
      uniforms.resolution.value.y = renderer.domElement.height
    }
    onResize()
    window.addEventListener("resize", onResize)

    let animationId = 0
    const animate = () => {
      if (cancelled) return;
      animationId = requestAnimationFrame(animate)
      if (!reduced) uniforms.time.value += 0.05 * speed
      try {
        renderer.render(scene, camera)
      } catch {
        cancelAnimationFrame(animationId)
        setGlOK(false);
      }
    }
    animate()

    cleanup.current = () => {
      window.removeEventListener("resize", onResize)
      cancelAnimationFrame(animationId)
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement)
      }
      renderer.dispose()
      geometry.dispose()
      material.dispose()
    };
    })();

    return () => {
      cancelled = true;
      if (cleanup.current) { cleanup.current(); cleanup.current = null; }
    };
  }, [glOK, speed, lineWidth, dispersion, tint, brightness])

  // Fallback estático (CSS puro): mesma identidade dourado/preto, zero WebGL.
  if (glOK === false) {
    return (
      <div
        className={className}
        style={{
          background:
            "radial-gradient(120% 90% at 50% 110%, rgba(255,170,60,0.28) 0%, rgba(255,170,60,0.06) 45%, #000 75%), #000",
          overflow: "hidden",
          ...style,
        }}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ background: "#000", overflow: "hidden", ...style }}
    />
  )
}
