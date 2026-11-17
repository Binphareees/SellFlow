import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { Badge, BackLink, SectionCard } from "@/components/ui";
import { NewDisputeForm, type DisputeOrderOption } from "@/components/dispute-actions";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function NewDisputePage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string; claimId?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  const { orderId, claimId } = await searchParams;

  // Only orders this account is a party to can be disputed.
  const orders = await prisma.supplierOrder.findMany({
    where: {
      OR: [
        { resellerProfileId: ctx.profile.id },
        { supplierProfile: { profileId: ctx.profile.id } },
      ],
    },
    include: {
      supplierProfile: { select: { businessName: true } },
      resellerProfile: { select: { displayName: true } },
      claims: {
        orderBy: { claimedAt: "desc" },
        select: { id: true, amountKobo: true, reference: true, status: true, claimedByRole: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 40,
  });

  const options: DisputeOrderOption[] = orders.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    counterparty:
      order.resellerProfileId === ctx.profile.id
        ? order.supplierProfile.businessName
        : order.resellerProfile.displayName,
    totalKobo: order.totalKobo,
    claims: order.claims.map((claim) => ({
      id: claim.id,
      amountKobo: claim.amountKobo,
      reference: claim.reference,
      status: claim.status,
      claimedByRole: claim.claimedByRole,
    })),
  }));

  const preset = options.find((option) => option.id === orderId);

  return (
    <>
      <BackLink href="/disputes">Disputes</BackLink>

      <div className="page-head">
        <div>
          <h1>Raise a dispute</h1>
          <p>Say what happened once, in writing, and both sides can build on it.</p>
        </div>
        {preset ? <Badge status="OPEN" tone="accent" /> : null}
      </div>

      {preset ? (
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">{preset.orderNumber}</div>
              <div className="card-sub">
                {preset.counterparty} · {formatMoney(preset.totalKobo)}
              </div>
            </div>
          </div>
          <p className="tiny muted">
            Opening a dispute does not move money and does not cancel the order. It puts the problem on
            the record so it can be settled or escalated.
          </p>
        </div>
      ) : null}

      <div className="mt-12">
        <SectionCard title="The details" sub="Be specific: dates, amounts, what was agreed">
          <NewDisputeForm orders={options} presetOrderId={orderId} presetClaimId={claimId} />
        </SectionCard>
      </div>
    </>
  );
}
