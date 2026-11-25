import type { Company, Plan } from "../../engine/types";
import type { ListingView } from "../careerPlan";
import { setGoPublic } from "../draft";
import { money } from "../format";
import { HINT } from "../styles";
import { Segmented } from "./Segmented";

interface GoPublicRowProps {
  listing: ListingView;
  company: Company;
  draft: Plan;
  onChange: (plan: Plan) => void;
}

/** Going public in a career's plan: stay private or list, with the exact amount when it is on offer, and why it may be out of reach. */
export const GoPublicRow = ({ listing, company, draft, onChange }: GoPublicRowProps) => {
  // A listed company has nothing left to choose: only the year it went public.
  if (listing.blocked === "listed") return <p className={HINT}>{listing.blockedText}</p>;
  return (
    <>
      <Segmented
        label="Go public"
        selected={listing.selected ? "public" : "private"}
        onSelect={(key) => onChange(setGoPublic(company, draft, key === "public"))}
        options={[
          { key: "private", label: "Stay private" },
          { key: "public", label: "Go public", sub: listing.blocked === null ? money(listing.amount) : undefined, disabled: listing.blocked !== null, title: listing.blockedText ?? undefined },
        ]}
      />
      <p className={`${HINT} mt-1.5`}>{listing.blockedText ?? listing.text}</p>
    </>
  );
};
