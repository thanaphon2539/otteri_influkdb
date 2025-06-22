import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { PoolingService } from './pooling.service';
import { CreatePoolingDto } from './dto/create-pooling.dto';
import { UpdatePoolingDto } from './dto/update-pooling.dto';

@Controller('pooling')
export class PoolingController {
  constructor(private readonly poolingService: PoolingService) {}

  @Post()
  create(@Body() createPoolingDto: CreatePoolingDto) {
    return this.poolingService.create(createPoolingDto);
  }

  @Get()
  findAll() {
    return this.poolingService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.poolingService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updatePoolingDto: UpdatePoolingDto) {
    return this.poolingService.update(+id, updatePoolingDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.poolingService.remove(+id);
  }
}
