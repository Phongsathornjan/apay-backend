import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Role } from '../users/entities/role.entity';
import { User } from '../users/entities/user.entity';
import { DatabaseSecurityService } from './database-security.service';
import { DatabaseSeederService } from './database-seeder.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, Role])],
  providers: [DatabaseSeederService, DatabaseSecurityService],
  exports: [DatabaseSeederService, DatabaseSecurityService],
})
export class DatabaseModule {}
