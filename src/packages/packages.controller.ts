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
import { CreatePackageDto } from './dto/create-package.dto';
import { UpdatePackageDto } from './dto/update-package.dto';
import { PackagesService } from './packages.service';

@Controller({
  path: 'packages',
  version: '1',
})
@UseGuards(JwtAuthGuard, RoleGuard)
export class PackagesController {
  constructor(private readonly packagesService: PackagesService) {}

  @Post()
  @Roles('admin')
  create(@Body() dto: CreatePackageDto) {
    return this.packagesService.create(dto);
  }

  @Get()
  @Roles('admin', 'business')
  findAll(
    @Req() request: Request & { user: AuthUser },
    @Query('only_active') onlyActive?: string,
  ) {
    const activeOnly =
      request.user.role === 'business' ? true : onlyActive === 'true';

    return this.packagesService.findAll(activeOnly);
  }

  @Get(':id')
  @Roles('admin', 'business')
  findOne(@Param('id') id: string) {
    return this.packagesService.findByIdOrFail(id);
  }

  @Patch(':id')
  @Roles('admin')
  update(@Param('id') id: string, @Body() dto: UpdatePackageDto) {
    return this.packagesService.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  remove(@Param('id') id: string) {
    return this.packagesService.softDelete(id);
  }
}
