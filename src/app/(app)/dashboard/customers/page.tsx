import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { listCustomers } from "@/server/workspace";
import { getEntitlements } from "@/lib/subscription";
import { prisma } from "@/lib/db";
import { formatMoney, whatsappReminderText } from "@/lib/money";
import { Empty, SectionCard, WhatsappLink } from "@/components/ui";
import { CustomerForm } from "@/components/workspace-actions";
import { UpgradeBanner } from "@/components/upgrade-banner";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const ctx = await getAuthContext();
  if (!ctx?.workspaceId) redirect("/login");

  const [customers, workspace, entitlements] = await Promise.all([
    listCustomers(ctx.workspaceId),
    prisma.businessWorkspace.findUnique({ where: { id: ctx.workspaceId }, select: { name: true, currency: true } }),
    getEntitlements(ctx.workspaceId),
  ]);
  const currency = workspace?.currency ?? "NGN";
  const businessName = workspace?.name ?? "My business";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Customers</h1>
          <p>{customers.length} saved</p>
        </div>
      </div>

      <UpgradeBanner tier={entitlements.tier} usage={entitlements.usage} limits={entitlements.limits} />

      <SectionCard title="Add a customer">
        <CustomerForm />
      </SectionCard>

      <div className="mt-16">
        <SectionCard title="All customers">
          {customers.length === 0 ? (
            <Empty>No customers yet.</Empty>
          ) : (
            <div className="list">
              {customers.map((customer) => (
                <div className="list-item" key={customer.id}>
                  <div className="grow">
                    <div className="list-title">{customer.name}</div>
                    <div className="list-meta">
                      {customer.phone ?? "No phone"} · {customer.orderCount} order
                      {customer.orderCount === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="list-right">
                    {customer.owedKobo > 0 ? (
                      <>
                        <div className="money owed">{formatMoney(customer.owedKobo, currency)}</div>
                        <div className="mt-12">
                          <WhatsappLink
                            phone={customer.phone}
                            message={whatsappReminderText({
                              businessName,
                              customerName: customer.name,
                              balanceMinor: customer.owedKobo,
                              currency,
                            })}
                            label="Remind"
                          />
                        </div>
                      </>
                    ) : (
                      <span className="tiny muted">Owes nothing</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </>
  );
}
