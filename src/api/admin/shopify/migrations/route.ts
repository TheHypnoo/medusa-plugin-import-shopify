import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { migrateCategoriesFromShopifyWorkflowId, migrateProductsFromShopifyWorkflowId } from "../../../../workflows"
import { z } from "zod"
import { AdminShopifyMigrationsPost } from "../../../middlewares"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const workflowEngine = req.scope.resolve("workflows")

  const [executions, count] = await workflowEngine.listAndCountWorkflowExecutions(
    {
      workflow_id: [migrateCategoriesFromShopifyWorkflowId, migrateProductsFromShopifyWorkflowId],
    },
    {
      order: {
        created_at: "DESC",
      },
    }
  )

  res.json({ workflow_executions: executions, count })
}

type AdminShopifyMigrationsPost = z.infer<typeof AdminShopifyMigrationsPost>

export async function POST(req: MedusaRequest<AdminShopifyMigrationsPost>, res: MedusaResponse) {
  const type = req.validatedBody.type

  const eventBusService = req.scope.resolve("event_bus")

  eventBusService.emit({
    name: "migrate.shopify",
    data: {
      type,
    },
  })

  res.json({ success: true })
}
