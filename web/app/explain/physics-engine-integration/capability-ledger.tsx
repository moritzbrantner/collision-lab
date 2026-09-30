"use client";

import { useEffect, useState } from "react";
import type {
  parseCapabilityLedger,
  parseSegmentWork,
} from "./parse-capability-ledger";
import styles from "./capability-ledger.module.css";

const messages = {
  en: {
    distances: "Measured segment distances",
    features: "Measured segment features",
    validation: "Validation and degeneracy",
    counters: "Engine work counters",
    title: "Physics Engine capability ledger",
    language: "Language",
    theme: "Appearance",
    light: "Light",
    dark: "Dark",
    system: "System",
    source: "Source",
    api: "World API",
    acceptance: "Global reference acceptance",
    description:
      "Engine-owned capability states are shown as API identifiers. Successful dispatch scenes below do not prove reference acceptance, angular CCD, or chronological secondary impacts.",
    shapes: "Shape restrictions",
    shape: "Shape",
    rotation: "Dynamic rotation",
    com: "Solver origin",
    collapsed: "Collapsed skeleton",
    capabilities: "Capabilities shared by all four shapes",
    capability: "Capability",
    status: "Status",
    pairs: "Pair capability matrix",
    pair: "Pair",
    classification: "Algorithm",
    points: "Manifold limit",
    translation: "Translation search",
    casts: "Shape cast search",
    fallback: "Generic fallback",
    reference: "Reference acceptance",
    yes: "yes",
    no: "no",
    note: "Wedge geometric mass properties do not change its solver origin or rotation restriction. Translation searches hold orientation fixed within each substep. Missing features remain explicitly listed.",
  },
  de: {
    distances: "Gemessene Segmentabstände",
    features: "Gemessene Segmentmerkmale",
    validation: "Validierung und Degeneration",
    counters: "Arbeitszähler der Engine",
    title: "Fähigkeiten der Physics Engine",
    language: "Sprache",
    theme: "Darstellung",
    light: "Hell",
    dark: "Dunkel",
    system: "System",
    source: "Quelle",
    api: "World-API",
    acceptance: "Globale Referenzprüfung",
    description:
      "Die Fähigkeiten der Engine erscheinen als API-Bezeichner. Erfolgreiche Dispatch-Szenen unten belegen weder die Referenzprüfung noch rotierende CCD oder chronologische Folgekontakte.",
    shapes: "Einschränkungen der Formen",
    shape: "Form",
    rotation: "Dynamische Rotation",
    com: "Solver-Ursprung",
    collapsed: "Reduziertes Skelett",
    capabilities: "Gemeinsame Fähigkeiten aller vier Formen",
    capability: "Fähigkeit",
    status: "Status",
    pairs: "Fähigkeiten der Formpaare",
    pair: "Paar",
    classification: "Algorithmus",
    points: "Manifold-Grenze",
    translation: "Translationssuche",
    casts: "Shape-Cast-Suche",
    fallback: "Generischer Fallback",
    reference: "Referenzprüfung",
    yes: "ja",
    no: "nein",
    note: "Die geometrischen Masseneigenschaften des Keils ändern weder seinen Solver-Ursprung noch seine Rotationseinschränkung. Translationssuchen halten die Orientierung pro Teilschritt konstant. Fehlende Fähigkeiten bleiben ausdrücklich aufgeführt.",
  },
  es: {
    distances: "Distancias de segmento medidas",
    features: "Características de segmento medidas",
    validation: "Validación y degeneración",
    counters: "Contadores de trabajo del motor",
    title: "Capacidades de Physics Engine",
    language: "Idioma",
    theme: "Apariencia",
    light: "Claro",
    dark: "Oscuro",
    system: "Sistema",
    source: "Fuente",
    api: "API World",
    acceptance: "Aceptación de referencia global",
    description:
      "Las capacidades del motor se muestran como identificadores de API. Las escenas de despacho de abajo no demuestran aceptación de referencia, CCD angular ni impactos secundarios cronológicos.",
    shapes: "Restricciones de las formas",
    shape: "Forma",
    rotation: "Rotación dinámica",
    com: "Origen del solver",
    collapsed: "Esqueleto reducido",
    capabilities: "Capacidades comunes de las cuatro formas",
    capability: "Capacidad",
    status: "Estado",
    pairs: "Matriz de capacidades por pares",
    pair: "Par",
    classification: "Algoritmo",
    points: "Límite del manifold",
    translation: "Búsqueda de traslación",
    casts: "Búsqueda de shape cast",
    fallback: "Fallback genérico",
    reference: "Aceptación de referencia",
    yes: "sí",
    no: "no",
    note: "Las propiedades geométricas de masa de la cuña no cambian su origen del solver ni su restricción de rotación. Las búsquedas de traslación mantienen fija la orientación en cada subpaso. Las capacidades ausentes siguen indicadas explícitamente.",
  },
};

function locale(value: string | null) {
  return value === "de" || value === "es" ? value : "en";
}
function theme(value: string | null) {
  return value === "light" || value === "dark" ? value : "system";
}

type Preferences = {
  locale: keyof typeof messages;
  theme: ReturnType<typeof theme>;
};

function readPreferences(): Preferences {
  const params = new URL(window.location.href).searchParams;
  let savedLocale: string | null = null;
  let savedTheme: string | null = null;
  try {
    savedLocale = localStorage.getItem("physics-lang");
    savedTheme = localStorage.getItem("physics-theme");
  } catch {
    /* URL preferences still work when browser storage is unavailable. */
  }
  return {
    locale: locale(params.get("physics-lang") ?? savedLocale),
    theme: theme(params.get("physics-theme") ?? savedTheme),
  };
}

export function CapabilityLedger({
  ledger,
  segmentWork,
  sourceRevision,
}: {
  ledger: ReturnType<typeof parseCapabilityLedger>;
  segmentWork: ReturnType<typeof parseSegmentWork>;
  sourceRevision: string;
}) {
  const [preferences, setPreferences] = useState<Preferences>({
    locale: "en",
    theme: "system",
  });
  useEffect(() => {
    const restore = () => setPreferences(readPreferences());
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  function update(next: Preferences) {
    const url = new URL(window.location.href);
    url.searchParams.set("physics-lang", next.locale);
    url.searchParams.set("physics-theme", next.theme);
    window.history.replaceState(null, "", url);
    try {
      localStorage.setItem("physics-lang", next.locale);
      localStorage.setItem("physics-theme", next.theme);
    } catch {
      /* The URL remains the shareable source for this view. */
    }
    setPreferences(next);
  }
  const copy = messages[preferences.locale];
  const number = new Intl.NumberFormat(preferences.locale, {
    maximumSignificantDigits: 15,
  });
  return (
    <section
      className={styles.panel}
      data-testid="physics-engine-capabilities"
      data-theme={preferences.theme}
      lang={preferences.locale}
    >
      <div className={styles.controls}>
        <label>
          {copy.language}
          <select
            value={preferences.locale}
            onChange={(event) =>
              update({ ...preferences, locale: locale(event.target.value) })
            }
          >
            <option value="en">English</option>
            <option value="de">Deutsch</option>
            <option value="es">Español</option>
          </select>
        </label>
        <label>
          {copy.theme}
          <select
            value={preferences.theme}
            onChange={(event) =>
              update({ ...preferences, theme: theme(event.target.value) })
            }
          >
            <option value="system">{copy.system}</option>
            <option value="light">{copy.light}</option>
            <option value="dark">{copy.dark}</option>
          </select>
        </label>
      </div>
      <h2>{copy.title}</h2>
      <p>{copy.description}</p>
      <p>
        {copy.api}:{" "}
        <code>
          {ledger.world} · {ledger.scalar} · {ledger.worldApiStatus}
        </code>
      </p>
      <p>
        {copy.acceptance}:{" "}
        <code data-testid="physics-engine-reference-acceptance">
          {ledger.referenceAcceptance}
        </code>
      </p>
      <p>
        {copy.source}:{" "}
        <a
          href={`https://github.com/moritzbrantner/physics-engine/blob/${sourceRevision}/docs/primitive-capabilities.md`}
        >
          <code>{sourceRevision.slice(0, 10)}</code>
        </a>
      </p>
      <div className={styles.scroll}>
        <table>
          <caption>{copy.shapes}</caption>
          <thead>
            <tr>
              <th>{copy.shape}</th>
              <th>{copy.rotation}</th>
              <th>{copy.com}</th>
              <th>{copy.collapsed}</th>
            </tr>
          </thead>
          <tbody>
            {ledger.shapes.map((shape) => (
              <tr key={shape.kind}>
                <th>
                  <code>{shape.kind}</code>
                </th>
                <td>
                  <code>{shape.solverDynamicRotation}</code>
                </td>
                <td>
                  <code>{shape.solverCom}</code>
                </td>
                <td>{shape.collapsedSkeleton ? copy.yes : copy.no}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>{copy.note}</p>
      <div className={styles.scroll}>
        <table data-testid="physics-engine-capability-states">
          <caption>{copy.capabilities}</caption>
          <thead>
            <tr>
              <th>{copy.capability}</th>
              <th>{copy.status}</th>
            </tr>
          </thead>
          <tbody>
            {ledger.capabilities.map((entry) => (
              <tr key={entry.key}>
                <th>
                  <code>{entry.key}</code>
                </th>
                <td>
                  <code>{entry.status}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.scroll}>
        <table data-testid="physics-engine-validation">
          <caption>{copy.validation}</caption>
          <thead>
            <tr>
              <th>{copy.capability}</th>
              <th>{copy.status}</th>
            </tr>
          </thead>
          <tbody>
            {ledger.validation.map((entry) => (
              <tr key={entry.key}>
                <th>
                  <code>{entry.key}</code>
                </th>
                <td>
                  {typeof entry.value === "boolean"
                    ? entry.value
                      ? copy.yes
                      : copy.no
                    : number.format(entry.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details>
        <summary>{copy.counters}</summary>
        <ul>
          {ledger.workCounters.map((counter) => (
            <li key={counter}>
              <code>{counter}</code>
            </li>
          ))}
        </ul>
      </details>
      <div className={styles.scroll}>
        <table data-testid="physics-engine-pair-capabilities">
          <caption>{copy.pairs}</caption>
          <thead>
            <tr>
              <th>{copy.pair}</th>
              <th>{copy.classification}</th>
              <th>{copy.points}</th>
              <th>{copy.translation}</th>
              <th>{copy.casts}</th>
              <th>{copy.fallback}</th>
              <th>{copy.reference}</th>
              <th>{copy.distances}</th>
              <th>{copy.features}</th>
            </tr>
          </thead>
          <tbody>
            {ledger.pairs.map((pair) => {
              const work = segmentWork.find(
                (entry) =>
                  (entry.left === pair.left && entry.right === pair.right) ||
                  (entry.left === pair.right && entry.right === pair.left),
              );
              return (
                <tr key={`${pair.left}:${pair.right}`}>
                  <th>
                    <code>
                      {pair.left} ↔ {pair.right}
                    </code>
                  </th>
                  <td>
                    <code>{pair.classification}</code>
                  </td>
                  <td>{number.format(pair.manifoldPointLimit)}</td>
                  <td>
                    <code>{pair.translationSearch}</code>
                  </td>
                  <td>
                    <code>{pair.shapeCastSearch}</code>
                  </td>
                  <td>
                    <code>{pair.genericFallback}</code>
                  </td>
                  <td>
                    <code>{pair.referenceAcceptance}</code>
                  </td>
                  <td data-testid="physics-engine-segment-distances">
                    {work ? number.format(work.distances) : "—"}
                  </td>
                  <td data-testid="physics-engine-segment-features">
                    {work ? number.format(work.features) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
