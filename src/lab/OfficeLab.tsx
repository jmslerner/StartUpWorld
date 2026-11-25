import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { TEAMS, type OfficeIndex } from "../world/types/scene";
import { WorldBoundary, WorldPlaceholder, WorldUnavailableNote } from "../world/ui/WorldShell";
import type { Lab } from "./lab";
import { headCount, MAX_COUNT, type SceneEdit } from "./labScene";
import { figureLines, headCountLine, LAB_WORDS, OFFICE_NAMES, officeChoice } from "./labWords";

/**
 * The lab page: one office made of numbers, and the controls that change them. Everything that decides anything is
 * in ./lab.ts and ./labScene.ts, and every word in ./labWords.ts; this file only lays them out.
 *
 * The 3D view, and three.js with it, loads lazily: the page and its controls are there first, and stay when the
 * view cannot be shown.
 */
const WorldView = lazy(() => import("../world/WorldView"));

/** How often the figures are read from the renderer. Reading them draws nothing. */
const FIGURES_EVERY_MS = 250;

type CountField = "product" | "growth" | "recruiting" | "away" | "leaving" | "arriving";
const EXTRAS: readonly CountField[] = ["away", "leaving", "arriving"];

interface LabProps {
  lab: Lab;
}

interface FieldProps {
  id: string;
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}

const Stepper = ({ id, label, value, max, onChange }: FieldProps) => (
  <div className="lab-row">
    <label htmlFor={id}>{label}</label>
    <div className="lab-stepper">
      <button type="button" aria-label={`${LAB_WORDS.fewer}: ${label}`} disabled={value <= 0} onClick={() => onChange(value - 1)}>
        −
      </button>
      <input id={id} type="number" inputMode="numeric" min={0} max={max} value={value} onChange={(event) => onChange(event.target.valueAsNumber)} />
      <button type="button" aria-label={`${LAB_WORDS.more}: ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  </div>
);

const NumberField = ({ id, label, value, max, onChange }: FieldProps) => (
  <div className="lab-row">
    <label htmlFor={id}>{label}</label>
    <input id={id} className="lab-input" type="number" inputMode="numeric" min={0} max={max} value={value} onChange={(event) => onChange(event.target.valueAsNumber)} />
  </div>
);

const Figures = ({ lab }: LabProps) => {
  const [lines, setLines] = useState(() => figureLines(lab.stats()).join("\n"));
  useEffect(() => {
    const read = (): void => {
      lab.sample();
      // The same text again is no change, so a view at rest re-renders nothing.
      setLines(figureLines(lab.stats()).join("\n"));
    };
    const timer = window.setInterval(read, FIGURES_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [lab]);
  return (
    <pre className="lab-figures" data-lab-figures>
      {lines}
    </pre>
  );
};

const Controls = ({ lab }: LabProps) => {
  const { scene, fitOffice, keepAwake, shown } = useSyncExternalStore(lab.subscribe, lab.getState);
  const count = (field: CountField): number => (field === "product" || field === "growth" || field === "recruiting" ? scene.teams[field] : scene[field]);
  const edit = (field: keyof SceneEdit) => (value: number) => lab.edit({ [field]: value });

  return (
    <aside className="lab-panel" aria-label={LAB_WORDS.showControls}>
      <h1>{LAB_WORDS.title}</h1>
      <p className="lab-quiet">{LAB_WORDS.intro}</p>

      <section>
        <h2>{LAB_WORDS.people}</h2>
        {[...TEAMS, ...EXTRAS].map((field) => (
          <Stepper key={field} id={`lab-${field}`} label={LAB_WORDS[field]} value={count(field)} max={MAX_COUNT} onChange={edit(field)} />
        ))}
        <p className="lab-quiet">{headCountLine(headCount(scene), scene.capacity)}</p>
      </section>

      <section>
        <div className="lab-row">
          <label htmlFor="lab-office">{LAB_WORDS.office}</label>
          <select
            id="lab-office"
            className="lab-input lab-wide"
            value={fitOffice ? "fit" : String(scene.office)}
            onChange={(event) => lab.setOffice(event.target.value === "fit" ? "fit" : (Number(event.target.value) as OfficeIndex))}
          >
            <option value="fit">
              {LAB_WORDS.fitOffice}: {OFFICE_NAMES[scene.office]}
            </option>
            {OFFICE_NAMES.map((name, office) => (
              <option key={name} value={office}>
                {officeChoice(office as OfficeIndex)}
              </option>
            ))}
          </select>
        </div>
        <NumberField id="lab-year" label={LAB_WORDS.year} value={scene.year} max={9999} onChange={edit("year")} />
        <div className="lab-row">
          <label htmlFor="lab-era">{LAB_WORDS.era}</label>
          <input id="lab-era" className="lab-input" type="text" autoComplete="off" spellCheck={false} value={scene.era} onChange={(event) => lab.edit({ era: event.target.value })} />
        </div>
        <NumberField id="lab-seed" label={LAB_WORDS.seed} value={scene.seed} max={0xffffffff} onChange={edit("seed")} />
      </section>

      <section className="lab-buttons">
        <button type="button" className="lab-button lab-main" onClick={lab.endYear}>
          {LAB_WORDS.endYear}
        </button>
        <button type="button" className="lab-button" onClick={lab.reset}>
          {LAB_WORDS.reset}
        </button>
      </section>

      <section>
        <label className="lab-check">
          <input type="checkbox" checked={keepAwake} onChange={(event) => lab.setKeepAwake(event.target.checked)} />
          {LAB_WORDS.keepAwake}
        </label>
        <label className="lab-check">
          <input type="checkbox" checked={shown} onChange={(event) => lab.setShown(event.target.checked)} />
          {LAB_WORDS.shown}
        </label>
      </section>

      <section>
        <h2>{LAB_WORDS.figures}</h2>
        <Figures lab={lab} />
      </section>

      <section>
        <h2>{LAB_WORDS.scene}</h2>
        <pre className="lab-json" data-lab-scene>
          {JSON.stringify(scene, null, 2)}
        </pre>
      </section>
    </aside>
  );
};

const Note = () => (
  <div className="lab-note">
    <WorldUnavailableNote />
  </div>
);

export const OfficeLab = ({ lab }: LabProps) => {
  const shown = useSyncExternalStore(lab.subscribe, () => lab.getState().shown);
  const panelOpen = useSyncExternalStore(lab.subscribe, () => lab.getState().panelOpen);

  return (
    <div className="lab-page">
      <main className="lab-view">
        <div className="lab-view-box">
          {shown ? (
            <WorldBoundary fallback={<Note />} onError={lab.viewFailed}>
              <Suspense fallback={<WorldPlaceholder />}>
                <WorldView source={lab.source} onState={lab.viewState} />
              </Suspense>
            </WorldBoundary>
          ) : (
            <div className="lab-note lab-quiet">{LAB_WORDS.off}</div>
          )}
        </div>
        <button type="button" className="lab-button lab-toggle" aria-expanded={panelOpen} onClick={() => lab.setPanelOpen(!panelOpen)}>
          {panelOpen ? LAB_WORDS.hideControls : LAB_WORDS.showControls}
        </button>
      </main>
      {panelOpen ? <Controls lab={lab} /> : null}
    </div>
  );
};
