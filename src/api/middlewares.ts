import { defineMiddlewares, validateAndTransformBody } from "@medusajs/framework/http"
import { z } from "zod"

export const AdminShopifyMigrationsPost = z.object({
  type: z.enum(["category", "product"]).array()
})

export default defineMiddlewares({
  routes: [
    {
      matcher: "/admin/shopify/migrations",
      method: "POST",
      middlewares: [
        validateAndTransformBody(AdminShopifyMigrationsPost)
      ]
    }
  ]
})
