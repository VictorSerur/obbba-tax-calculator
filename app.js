import React, { useMemo, useState } from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(React.createElement);

const FILING_STATUSES = {
  single: {
    label: "Single",
    standardDeduction: 16100,
    agedDeduction: 2050,
    childCreditThreshold: 200000,
    seniorDeductionThreshold: 75000,
    temporaryDeductionThreshold: 150000,
    carInterestThreshold: 100000,
    brackets: [
      [12400, 0.1],
      [50400, 0.12],
      [105700, 0.22],
      [201775, 0.24],
      [256225, 0.32],
      [640600, 0.35],
      [Infinity, 0.37],
    ],
  },
  headOfHousehold: {
    label: "Head of household",
    standardDeduction: 24150,
    agedDeduction: 2050,
    childCreditThreshold: 200000,
    seniorDeductionThreshold: 75000,
    temporaryDeductionThreshold: 150000,
    carInterestThreshold: 100000,
    brackets: [
      [17700, 0.1],
      [67450, 0.12],
      [105700, 0.22],
      [201750, 0.24],
      [256200, 0.32],
      [640600, 0.35],
      [Infinity, 0.37],
    ],
  },
  marriedJoint: {
    label: "Married filing jointly",
    standardDeduction: 32200,
    agedDeduction: 1650,
    childCreditThreshold: 400000,
    seniorDeductionThreshold: 150000,
    temporaryDeductionThreshold: 300000,
    carInterestThreshold: 200000,
    brackets: [
      [24800, 0.1],
      [100800, 0.12],
      [211400, 0.22],
      [403550, 0.24],
      [512450, 0.32],
      [768700, 0.35],
      [Infinity, 0.37],
    ],
  },
  marriedSeparate: {
    label: "Married filing separately",
    standardDeduction: 16100,
    agedDeduction: 1650,
    childCreditThreshold: 200000,
    seniorDeductionThreshold: 75000,
    temporaryDeductionThreshold: 150000,
    carInterestThreshold: 100000,
    brackets: [
      [12400, 0.1],
      [50400, 0.12],
      [105700, 0.22],
      [201775, 0.24],
      [256225, 0.32],
      [384350, 0.35],
      [Infinity, 0.37],
    ],
  },
};

const YEAR_MIN = 2026;
const YEAR_MAX = 2050;

const SOURCE_LINKS = [
  {
    label: "IRS OBBB individuals and workers",
    href: "https://www.irs.gov/newsroom/one-big-beautiful-bill-provisions-individuals-and-workers",
  },
  {
    label: "IRS 2026 inflation adjustments",
    href: "https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill",
  },
  {
    label: "IRS 2026 child tax credit guidance",
    href: "https://www.irs.gov/credits-deductions/individuals/child-tax-credit",
  },
  {
    label: "IRS Publication 505 tax schedules",
    href: "https://www.irs.gov/publications/p505",
  },
];

function currency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function percent(value) {
  return `${value.toFixed(1)}%`;
}

function parseMoney(value) {
  const numeric = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function roundTo(value, step) {
  return Math.round(value / step) * step;
}

function projectPermanentValue(baseValue, year, inflationRate, step) {
  if (year <= 2026) {
    return baseValue;
  }

  const years = year - 2026;
  return roundTo(baseValue * (1 + inflationRate / 100) ** years, step);
}

function phaseDownByThousand(amount, magi, threshold, reductionPerThousand) {
  if (magi <= threshold) {
    return amount;
  }

  const reduction = Math.ceil((magi - threshold) / 1000) * reductionPerThousand;
  return Math.max(0, amount - reduction);
}

function phaseDownByPercent(amount, magi, threshold, rate) {
  if (magi <= threshold) {
    return amount;
  }

  const reduction = (magi - threshold) * rate;
  return Math.max(0, amount - reduction);
}

function computeTaxFromBrackets(taxableIncome, brackets) {
  let lastCap = 0;
  let total = 0;
  const layers = [];

  for (const [cap, rate] of brackets) {
    if (taxableIncome <= lastCap) {
      break;
    }

    const amountInBracket = Math.min(taxableIncome, cap) - lastCap;
    const taxForBracket = amountInBracket * rate;

    layers.push({
      rate,
      amount: amountInBracket,
      tax: taxForBracket,
    });

    total += taxForBracket;
    lastCap = cap;
  }

  return { total, layers };
}

function childTaxCreditAmount(children, statusKey, year, inflationRate, magi) {
  const status = FILING_STATUSES[statusKey];
  const basePerChild = year === 2026 ? 2200 : projectPermanentValue(2200, year, inflationRate, 50);
  const grossCredit = children * basePerChild;

  if (grossCredit === 0) {
    return 0;
  }

  const reduction = Math.ceil(Math.max(0, magi - status.childCreditThreshold) / 1000) * 50;
  return Math.max(0, grossCredit - reduction);
}

function deriveYearConfig(year, inflationRate, statusKey) {
  const status = FILING_STATUSES[statusKey];

  return {
    status,
    standardDeduction: projectPermanentValue(status.standardDeduction, year, inflationRate, 50),
    agedDeduction: projectPermanentValue(status.agedDeduction, year, inflationRate, 50),
    brackets: status.brackets.map(([cap, rate]) => [
      cap === Infinity ? Infinity : projectPermanentValue(cap, year, inflationRate, 25),
      rate,
    ]),
  };
}

function NumberField({ label, value, onChange, hint, step = "1", min = "0" }) {
  return html`
    <label className="block space-y-2">
      <div className="flex items-end justify-between gap-3">
        <span className="text-sm font-medium text-ink/80">${label}</span>
        ${hint &&
        html`<span className="text-xs uppercase tracking-[0.18em] text-ink/45">${hint}</span>`}
      </div>
      <input
        type="number"
        min=${min}
        step=${step}
        value=${value}
        onChange=${onChange}
        className="w-full rounded-lg border border-ink/10 bg-white/80 px-4 py-3 text-base text-ink outline-none transition focus:border-moss focus:ring-2 focus:ring-moss/20"
      />
    </label>
  `;
}

function App() {
  const [filingStatus, setFilingStatus] = useState("single");
  const [taxYear, setTaxYear] = useState(2026);
  const [inflationRate, setInflationRate] = useState(2.5);
  const [grossIncome, setGrossIncome] = useState(95000);
  const [qualifiedTips, setQualifiedTips] = useState(0);
  const [qualifiedOvertime, setQualifiedOvertime] = useState(0);
  const [carLoanInterest, setCarLoanInterest] = useState(0);
  const [qualifyingChildren, setQualifyingChildren] = useState(0);
  const [taxpayerAge65, setTaxpayerAge65] = useState(false);
  const [spouseAge65, setSpouseAge65] = useState(false);

  const results = useMemo(() => {
    const year = Math.min(YEAR_MAX, Math.max(YEAR_MIN, Number(taxYear) || YEAR_MIN));
    const inflation = Math.max(0, Number(inflationRate) || 0);
    const income = parseMoney(grossIncome);
    const magiProxy = income;
    const children = Math.max(0, Number(qualifyingChildren) || 0);
    const config = deriveYearConfig(year, inflation, filingStatus);
    const isJoint = filingStatus === "marriedJoint";
    const temporaryDeductionsActive = year <= 2028;
    const temporaryDeductionsAllowed = filingStatus !== "marriedSeparate";

    const seniorCount = isJoint ? Number(taxpayerAge65) + Number(spouseAge65) : Number(taxpayerAge65);
    const agedStandardDeduction = seniorCount * config.agedDeduction;

    const baseSeniorDeduction = temporaryDeductionsActive && temporaryDeductionsAllowed
      ? seniorCount * 6000
      : 0;
    const seniorDeduction = phaseDownByPercent(
      baseSeniorDeduction,
      magiProxy,
      config.status.seniorDeductionThreshold,
      0.06,
    );

    const tipsDeduction = temporaryDeductionsActive && temporaryDeductionsAllowed
      ? phaseDownByThousand(
          Math.min(parseMoney(qualifiedTips), 25000),
          magiProxy,
          config.status.temporaryDeductionThreshold,
          100,
        )
      : 0;

    const overtimeCap = isJoint ? 25000 : 12500;
    const overtimeDeduction = temporaryDeductionsActive && temporaryDeductionsAllowed
      ? phaseDownByThousand(
          Math.min(parseMoney(qualifiedOvertime), overtimeCap),
          magiProxy,
          config.status.temporaryDeductionThreshold,
          100,
        )
      : 0;

    const carInterestDeduction = temporaryDeductionsActive
      ? phaseDownByThousand(
          Math.min(parseMoney(carLoanInterest), 10000),
          magiProxy,
          config.status.carInterestThreshold,
          200,
        )
      : 0;

    const totalDeductions =
      config.standardDeduction +
      agedStandardDeduction +
      seniorDeduction +
      tipsDeduction +
      overtimeDeduction +
      carInterestDeduction;

    const taxableIncome = Math.max(0, income - totalDeductions);
    const taxComputation = computeTaxFromBrackets(taxableIncome, config.brackets);
    const childTaxCredit = childTaxCreditAmount(children, filingStatus, year, inflation, magiProxy);
    const childCreditUsed = Math.min(taxComputation.total, childTaxCredit);
    const taxAfterCredits = Math.max(0, taxComputation.total - childTaxCredit);
    const effectiveRate = income > 0 ? (taxAfterCredits / income) * 100 : 0;

    return {
      year,
      inflation,
      income,
      magiProxy,
      config,
      seniorCount,
      agedStandardDeduction,
      seniorDeduction,
      tipsDeduction,
      overtimeDeduction,
      carInterestDeduction,
      totalDeductions,
      taxableIncome,
      taxBeforeCredits: taxComputation.total,
      taxAfterCredits,
      effectiveRate,
      childTaxCredit,
      childCreditUsed,
      layers: taxComputation.layers,
      projected: year > 2026,
      temporaryDeductionsActive,
      temporaryDeductionsAllowed,
    };
  }, [
    filingStatus,
    taxYear,
    inflationRate,
    grossIncome,
    qualifiedTips,
    qualifiedOvertime,
    carLoanInterest,
    qualifyingChildren,
    taxpayerAge65,
    spouseAge65,
  ]);

  return html`
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <section className="grid-paper overflow-hidden rounded-[28px] border border-ink/10 bg-paper shadow-panel">
          <div className="glow-line h-1 w-full"></div>
          <div className="grid gap-10 px-5 py-6 sm:px-8 lg:grid-cols-[1.02fr_0.98fr] lg:px-10 lg:py-10">
            <div className="space-y-8">
              <div className="space-y-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-moss">
                  United States Federal Estimate
                </p>
                <div className="space-y-3">
                  <h1 className="max-w-2xl font-display text-4xl leading-none text-ink sm:text-5xl">
                    OBBB tax calculator for 2026 and the years after it.
                  </h1>
                  <p className="max-w-2xl font-serif text-lg leading-7 text-ink/72">
                    Built around the IRS-published One, Big, Beautiful Bill Act rules for tax year 2026, with transparent projections for later years when the IRS has not yet published final inflation adjustments.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-ink/80">Filing status</span>
                  <select
                    value=${filingStatus}
                    onChange=${(event) => setFilingStatus(event.target.value)}
                    className="w-full rounded-lg border border-ink/10 bg-white/80 px-4 py-3 text-base text-ink outline-none transition focus:border-moss focus:ring-2 focus:ring-moss/20"
                  >
                    ${Object.entries(FILING_STATUSES).map(
                      ([value, item]) => html`<option key=${value} value=${value}>${item.label}</option>`,
                    )}
                  </select>
                </label>

                <${NumberField}
                  label="Tax year"
                  value=${taxYear}
                  min=${YEAR_MIN}
                  step="1"
                  hint=${results.projected ? "Projected" : "Exact 2026"}
                  onChange=${(event) => setTaxYear(event.target.value)}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <${NumberField}
                  label="Gross income"
                  value=${grossIncome}
                  step="100"
                  hint="AGI proxy"
                  onChange=${(event) => setGrossIncome(event.target.value)}
                />
                <${NumberField}
                  label="Inflation assumption"
                  value=${inflationRate}
                  step="0.1"
                  hint="For 2027+"
                  onChange=${(event) => setInflationRate(event.target.value)}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <${NumberField}
                  label="Qualified tips included in income"
                  value=${qualifiedTips}
                  step="100"
                  hint="2025-2028 only"
                  onChange=${(event) => setQualifiedTips(event.target.value)}
                />
                <${NumberField}
                  label="Qualified overtime premium"
                  value=${qualifiedOvertime}
                  step="100"
                  hint="Half of time-and-a-half"
                  onChange=${(event) => setQualifiedOvertime(event.target.value)}
                />
                <${NumberField}
                  label="Qualified car-loan interest"
                  value=${carLoanInterest}
                  step="50"
                  hint="New U.S.-assembled vehicle"
                  onChange=${(event) => setCarLoanInterest(event.target.value)}
                />
                <${NumberField}
                  label="Qualifying children under 17"
                  value=${qualifyingChildren}
                  step="1"
                  onChange=${(event) => setQualifyingChildren(event.target.value)}
                />
              </div>

              <div className="rounded-2xl border border-ink/10 bg-white/70 p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="font-display text-xl text-ink">Age-based deductions</h2>
                    <p className="mt-1 text-sm text-ink/60">
                      Includes the normal age 65+ standard deduction bump and the temporary enhanced senior deduction through 2028.
                    </p>
                  </div>
                  <div className="rounded-full bg-blush px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-copper">
                    ${results.seniorCount > 0 ? `${results.seniorCount} active` : "Optional"}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="flex items-center justify-between rounded-xl border border-ink/10 bg-paper px-4 py-3">
                    <span className="text-sm font-medium text-ink">Taxpayer is 65+</span>
                    <input
                      type="checkbox"
                      checked=${taxpayerAge65}
                      onChange=${(event) => setTaxpayerAge65(event.target.checked)}
                      className="h-5 w-5 rounded border-ink/20 text-moss focus:ring-moss/30"
                    />
                  </label>

                  ${filingStatus === "marriedJoint"
                    ? html`
                        <label className="flex items-center justify-between rounded-xl border border-ink/10 bg-paper px-4 py-3">
                          <span className="text-sm font-medium text-ink">Spouse is 65+</span>
                          <input
                            type="checkbox"
                            checked=${spouseAge65}
                            onChange=${(event) => setSpouseAge65(event.target.checked)}
                            className="h-5 w-5 rounded border-ink/20 text-moss focus:ring-moss/30"
                          />
                        </label>
                      `
                    : html`
                        <div className="rounded-xl border border-dashed border-ink/10 bg-paper/70 px-4 py-3 text-sm text-ink/48">
                          Joint-return-only rules apply to the OBBB senior deduction if you are married.
                        </div>
                      `}
                </div>
              </div>

              <div className="rounded-2xl border border-ink/10 bg-ink px-5 py-5 text-paper">
                <p className="text-xs uppercase tracking-[0.18em] text-gold">Important guardrails</p>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-paper/80">
                  <li>This is a federal income tax estimate, not filing software.</li>
                  <li>It assumes your gross income is a workable proxy for MAGI unless you have special exclusions.</li>
                  <li>It uses standard deduction logic and does not model AMT, NIIT, EITC, self-employment tax, or every credit.</li>
                  <li>For years after 2026, permanent indexed values are projected with your inflation setting because official IRS brackets for those years are not yet published.</li>
                </ul>
              </div>
            </div>

            <div className="space-y-5">
              <section className="rounded-[24px] border border-ink/10 bg-white/75 p-5 shadow-sm backdrop-blur">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-moss">
                      Estimated federal tax
                    </p>
                    <h2 className="mt-1 font-display text-4xl text-ink">
                      ${currency(results.taxAfterCredits)}
                    </h2>
                  </div>
                  <div className="rounded-2xl border border-ink/10 bg-paper px-4 py-3 text-right">
                    <div className="text-xs uppercase tracking-[0.18em] text-ink/45">Effective rate</div>
                    <div className="mt-1 font-display text-2xl text-copper">${percent(results.effectiveRate)}</div>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-ink/10 bg-paper px-4 py-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-ink/45">Taxable income</div>
                    <div className="mt-2 font-display text-2xl text-ink">${currency(results.taxableIncome)}</div>
                  </div>
                  <div className="rounded-2xl border border-ink/10 bg-paper px-4 py-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-ink/45">Total deductions</div>
                    <div className="mt-2 font-display text-2xl text-ink">${currency(results.totalDeductions)}</div>
                  </div>
                  <div className="rounded-2xl border border-ink/10 bg-paper px-4 py-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-ink/45">Tax before credits</div>
                    <div className="mt-2 font-display text-2xl text-ink">${currency(results.taxBeforeCredits)}</div>
                  </div>
                  <div className="rounded-2xl border border-ink/10 bg-paper px-4 py-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-ink/45">Child tax credit used</div>
                    <div className="mt-2 font-display text-2xl text-ink">${currency(results.childCreditUsed)}</div>
                    <div className="mt-1 text-xs text-ink/50">Refundable ACTC not modeled</div>
                  </div>
                </div>
              </section>

              <section className="rounded-[24px] border border-ink/10 bg-white/75 p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-display text-2xl text-ink">Deduction mix</h3>
                  <span className="rounded-full bg-moss px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-paper">
                    ${results.projected ? `Projected ${results.year}` : "IRS 2026 values"}
                  </span>
                </div>

                <div className="mt-4 space-y-3">
                  ${[
                    ["Standard deduction", results.config.standardDeduction],
                    ["Age 65+ standard add-on", results.agedStandardDeduction],
                    ["OBBB senior deduction", results.seniorDeduction],
                    ["OBBB tips deduction", results.tipsDeduction],
                    ["OBBB overtime deduction", results.overtimeDeduction],
                    ["OBBB car-loan interest deduction", results.carInterestDeduction],
                  ].map(
                    ([label, amount]) => html`
                      <div key=${label} className="flex items-center justify-between gap-4 rounded-xl border border-ink/8 bg-paper/85 px-4 py-3">
                        <span className="text-sm text-ink/72">${label}</span>
                        <span className="font-semibold text-ink">${currency(amount)}</span>
                      </div>
                    `,
                  )}
                </div>

                ${!results.temporaryDeductionsActive &&
                html`
                  <p className="mt-4 rounded-xl bg-blush px-4 py-3 text-sm leading-6 text-copper">
                    The temporary OBBB deductions for seniors, tips, overtime, and car-loan interest are modeled as expired after tax year 2028.
                  </p>
                `}

                ${!results.temporaryDeductionsAllowed &&
                html`
                  <p className="mt-4 rounded-xl bg-blush px-4 py-3 text-sm leading-6 text-copper">
                    Married filing separately is treated as ineligible for the OBBB tips, overtime, and enhanced senior deductions because the IRS requires a joint return for those benefits.
                  </p>
                `}
              </section>

              <section className="rounded-[24px] border border-ink/10 bg-white/75 p-5">
                <h3 className="font-display text-2xl text-ink">Bracket walk</h3>
                <div className="mt-4 space-y-3">
                  ${results.layers.map(
                    (layer, index) => html`
                      <div key=${index} className="rounded-xl border border-ink/8 bg-paper/85 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm uppercase tracking-[0.16em] text-ink/45">
                            ${Math.round(layer.rate * 100)}% bracket
                          </span>
                          <span className="font-semibold text-ink">${currency(layer.tax)}</span>
                        </div>
                        <div className="mt-1 text-sm text-ink/60">
                          ${currency(layer.amount)} taxed at ${Math.round(layer.rate * 100)}%
                        </div>
                      </div>
                    `,
                  )}
                </div>
              </section>

              <section className="rounded-[24px] border border-ink/10 bg-white/75 p-5">
                <h3 className="font-display text-2xl text-ink">Source footing</h3>
                <p className="mt-2 text-sm leading-6 text-ink/65">
                  2026 values are anchored to IRS material published after the One, Big, Beautiful Bill Act became law on July 4, 2025. Later years use the same law structure with a configurable inflation projection for indexed amounts.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  ${SOURCE_LINKS.map(
                    (item) => html`
                      <a
                        key=${item.href}
                        href=${item.href}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-ink/10 bg-paper px-3 py-2 text-sm text-ink transition hover:border-moss hover:text-moss"
                      >
                        ${item.label}
                      </a>
                    `,
                  )}
                </div>
              </section>
            </div>
          </div>
        </section>
      </div>
    </main>
  `;
}

createRoot(document.getElementById("root")).render(html`<${App} />`);