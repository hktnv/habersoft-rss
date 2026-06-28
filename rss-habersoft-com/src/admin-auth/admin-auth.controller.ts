import { Body, Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AdminAuthService, type AdminCookieMutation, type AdminSessionResponse } from "./admin-auth.service";

@Controller("admin-auth")
export class AdminAuthController {
  public constructor(private readonly adminAuth: AdminAuthService) {}

  @Get("session")
  public async session(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<AdminSessionResponse> {
    const response = await this.adminAuth.session(request);
    noStore(reply);
    if (!response.configured) {
      reply.status(501);
    }

    return response;
  }

  @Post("login")
  @HttpCode(200)
  public async login(
    @Req() request: FastifyRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<AdminSessionResponse> {
    const result = await this.adminAuth.login(request, body);
    noStore(reply);
    applyCookie(reply, result.cookie);
    return result.response;
  }

  @Post("logout")
  @HttpCode(200)
  public async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<AdminSessionResponse> {
    const result = await this.adminAuth.logout(request);
    noStore(reply);
    applyCookie(reply, result.cookie);
    if (!result.response.configured) {
      reply.status(501);
    }

    return result.response;
  }
}

function noStore(reply: FastifyReply): void {
  reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
}

function applyCookie(reply: FastifyReply, mutation: AdminCookieMutation): void {
  if (mutation.kind === "set" || mutation.kind === "clear") {
    reply.header("Set-Cookie", mutation.cookie);
  }
}

