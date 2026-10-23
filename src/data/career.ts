/**
 * Employment history, engineering roles only, transcribed from the owner's
 * LinkedIn profile (2026-10-10). Keep in sync with LinkedIn: recruiters
 * cross-check, and a mismatch reads worse than an omission.
 *
 * The bundled snapshot: the live list comes from beacon-api's D1 `career`
 * table when it answers (src/data/content.ts, beacon-api/README.md "Editing
 * the content"), and this is the fallback. beacon-api/content-seed.sql is
 * generated from it (npm run content:seed; tests/contentSeed.test.ts).
 *
 * Projects (src/data/projects.json) are personal work and live separately.
 */
export interface CareerEntry {
  role: string;
  company: string;
  /** Shown after the company, e.g. a rebrand or an on-site client. */
  note?: string;
  start: string;
  /** Omitted for the current role. */
  end?: string;
  employment: "Full-time" | "Contract";
  location: string;
  summary: string;
}

export const BUNDLED_CAREER: readonly CareerEntry[] = [
  {
    role: "Front End Developer",
    company: "Hubexo",
    note: "formerly BCI Central",
    start: "Nov 2020",
    employment: "Full-time",
    location: "Jakarta, Indonesia",
    summary:
      "Builds the visual layer of the company's web applications, working between backend developers who own server-side logic and UI/UX designers who own the design system.",
  },
  {
    role: "Lead Front End Developer",
    company: "Ericsson",
    start: "Apr 2020",
    end: "Apr 2022",
    employment: "Contract",
    location: "Jakarta, Indonesia",
    summary:
      "Led front-end development on a React stack: set up and maintained application environments and worked with other front-end developers, project managers and the backend team.",
  },
  {
    role: "React Js Developer",
    company: "Indocyber Global Teknologi",
    note: "on site at Blue Bird Group",
    start: "Sep 2019",
    end: "Dec 2020",
    employment: "Contract",
    location: "Jakarta, Indonesia",
    summary: "React development embedded with the client team at Blue Bird Group.",
  },
  {
    role: "Senior Front-End & JavaScript Developer",
    company: "PT Agape Software Internasional",
    start: "Jan 2017",
    end: "Sep 2019",
    employment: "Full-time",
    location: "Greater Jakarta, Indonesia",
    summary:
      "Built and maintained SEO- and performance-optimised front ends for business and e-commerce sites with React, React Native, Ext JS and jQuery; ran accessibility, usability and W3C validation audits.",
  },
  {
    role: "Front-End Developer",
    company: "SoftwareSeni",
    start: "Jun 2015",
    end: "Jan 2016",
    employment: "Full-time",
    location: "Yogyakarta, Indonesia",
    summary: "Developed and maintained client applications.",
  },
];

/**
 * Engineering experience for "N+ years" copy. Fixed rather than computed from
 * the 2015 start: most of 2016 was outside engineering, so a year subtraction
 * overstates it. Bump by hand (and in index.html's noscript summary).
 */
export const EXPERIENCE_LABEL = "10+ years";
