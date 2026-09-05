import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "./init";
import { apiKeysRouter } from "./routers/api-keys";
import { dashboardRouter } from "./routers/dashboard";
import { casesRouter } from "./routers/cases";

const todos = [
	{ id: 1, name: "Get groceries" },
	{ id: 2, name: "Buy a new phone" },
	{ id: 3, name: "Finish the project" },
];

const todosRouter = createTRPCRouter({
	list: publicProcedure.query(() => todos),
	add: publicProcedure
		.input(z.object({ name: z.string() }))
		.mutation(({ input }) => {
			const newTodo = { id: todos.length + 1, name: input.name };
			todos.push(newTodo);
			return newTodo;
		}),
});

export const trpcRouter = createTRPCRouter({
	todos: todosRouter,
	apiKeys: apiKeysRouter,
	dashboard: dashboardRouter,
	cases: casesRouter,
});
export type TRPCRouter = typeof trpcRouter;
