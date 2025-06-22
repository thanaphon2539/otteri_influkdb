import { Injectable } from '@nestjs/common';
import { CreatePoolingDto } from './dto/create-pooling.dto';
import { UpdatePoolingDto } from './dto/update-pooling.dto';

@Injectable()
export class PoolingService {
  create(createPoolingDto: CreatePoolingDto) {
    return 'This action adds a new pooling';
  }

  findAll() {
    return `This action returns all pooling`;
  }

  findOne(id: number) {
    return `This action returns a #${id} pooling`;
  }

  update(id: number, updatePoolingDto: UpdatePoolingDto) {
    return `This action updates a #${id} pooling`;
  }

  remove(id: number) {
    return `This action removes a #${id} pooling`;
  }
}
