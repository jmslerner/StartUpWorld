import { Component, lazy, Suspense, type ReactNode } from "react";
import { OFFICE_WORDS } from "../officeView";
import type { CareerOfficeProps } from "./CareerOffice";

/** The office and three.js with it, loaded only when a career shows its office. */
const CareerOffice = lazy(() => import("./CareerOffice"));

interface CatchProps {
  readonly children: ReactNode;
  readonly onFailed: () => void;
}

/** Whatever goes wrong in the office, its chunk failing to load included, ends here and nowhere else on the page. */
class OfficeCatch extends Component<CatchProps, { failed: boolean }> {
  constructor(props: CatchProps) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    console.warn("[office] The 3D office could not be shown; the 2D screens carry on.", error);
    this.props.onFailed();
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/** Holds the office's place while its code loads. */
const Opening = () => (
  <div aria-hidden className="grid h-full w-full place-items-center rounded-xl text-[0.7rem] uppercase tracking-[0.1em] text-mist/40">
    {OFFICE_WORDS.opening}
  </div>
);

/** The career's office, loaded lazily, inside a boundary of its own. Imports nothing from the world by value. */
export const OfficeSlot = (props: CareerOfficeProps) => (
  <OfficeCatch onFailed={props.onFailed}>
    <Suspense fallback={<Opening />}>
      <CareerOffice {...props} />
    </Suspense>
  </OfficeCatch>
);
