import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { AuthUser } from '../auth/types/auth-user.type';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UpdateApiKeyDto } from './dto/update-api-key.dto';
import { RoleEnum } from '../enums/role.enum'
@Controller({
  path: 'api-keys',
  version: '1',
})
@UseGuards(JwtAuthGuard, RoleGuard)
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  @Roles(RoleEnum.ADMIN, RoleEnum.BUSINESS)
  create(
    @Req() request: Request & { user: AuthUser },
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.apiKeysService.createApiKey(request.user, dto);
  }

  @Get()
  @Roles(RoleEnum.ADMIN, RoleEnum.BUSINESS)
  findAll(
    @Req() request: Request & { user: AuthUser },
    @Query('business_id') businessId?: string,
  ) {
    return this.apiKeysService.findAll(request.user, businessId);
  }

  @Get('usage/business/:businessId')
  @Roles(RoleEnum.ADMIN, RoleEnum.BUSINESS)
  getBusinessUsage(
    @Req() request: Request & { user: AuthUser },
    @Param('businessId') businessId: string,
  ) {
    return this.apiKeysService.getBusinessUsage(request.user, businessId);
  }

  @Get(':id/usage')
  @Roles(RoleEnum.ADMIN, RoleEnum.BUSINESS)
  getKeyUsage(
    @Req() request: Request & { user: AuthUser },
    @Param('id') id: string,
  ) {
    return this.apiKeysService.getKeyUsage(request.user, id);
  }

  @Patch(':id')
  @Roles(RoleEnum.ADMIN, RoleEnum.BUSINESS)
  update(
    @Req() request: Request & { user: AuthUser },
    @Param('id') id: string,
    @Body() dto: UpdateApiKeyDto,
  ) {
    return this.apiKeysService.updateStatusOrName(request.user, id, dto);
  }

  @Delete(':id')
  @Roles(RoleEnum.ADMIN, RoleEnum.BUSINESS)
  remove(
    @Req() request: Request & { user: AuthUser },
    @Param('id') id: string,
  ) {
    return this.apiKeysService.revokeApiKey(request.user, id);
  }
}
