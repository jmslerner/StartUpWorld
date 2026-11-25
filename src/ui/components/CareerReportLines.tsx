import type { CareerReportView } from "../careerReport";
import { officePhrase } from "../careerTimeline";
import { money, signed } from "../format";
import { TONE } from "../styles";

/** Hype a listing or a rescue moved, as a note: "hype +5", or nothing when it moved none. */
const hypeNote = (hype: number): string | null => (hype === 0 ? null : `hype ${signed(Math.round(hype), String)}`);

/** Quality points in words: a fraction of a point still shows as lost. */
const points = (quality: number): string => (quality < 1 ? "less than 1 point" : quality < 2 ? "1 point" : `${Math.floor(quality)} points`);

/** The career's own lines in the annual report: going public, a rescue, an office move and its bill, the year's card. */
export const CareerReportLines = ({ view }: { view: CareerReportView }) => {
  const listingHype = view.listing === null ? null : hypeNote(view.listing.hype);
  const rescueHype = view.rescue === null ? null : hypeNote(view.rescue.hype);
  return (
    <ul className="space-y-1 text-mist">
      {view.listing !== null && (
        <li className={TONE.good}>
          {view.listing.text}
          {listingHype !== null && <span className="text-mist/70"> ({listingHype})</span>}
        </li>
      )}
      {view.rescue !== null && (
        <li className={TONE.danger}>
          {view.rescue.text}
          {rescueHype !== null && <span className="text-mist/70"> ({rescueHype})</span>}
        </li>
      )}
      {view.office !== null && (
        <li>
          You moved from {officePhrase(view.office.from, "your")} to {officePhrase(view.office.to, "your")}. The move cost {money(view.office.bill)}.
        </li>
      )}
      {view.qualityLostToEvent > 0 && <li className={TONE.caution}>The year&apos;s card cost your product {points(view.qualityLostToEvent)} of quality.</li>}
    </ul>
  );
};
