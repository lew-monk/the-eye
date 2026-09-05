import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { Button } from "@workspace/ui";
import { AppShell } from "#/components/app-shell";

export const Route = createFileRoute("/profile")({ component: ProfileLayout });

function ProfileLayout() {
	const navigate = useNavigate();

	return (
		<AppShell>
			<div className="p-4 lg:p-6 max-w-[960px] mx-auto space-y-6">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="font-mono text-lg font-bold tracking-widest text-primary">
							PROFILE
						</h1>
						<p className="font-mono text-body uppercase tracking-[0.12em] text-outline mt-1">
							MANAGE_API_KEYS
						</p>
					</div>
					<Button variant="ghost" size="sm" onClick={() => navigate({ to: "/" })}>
						BACK_TO_DASHBOARD
					</Button>
				</div>

				<Outlet />
			</div>
		</AppShell>
	);
}
