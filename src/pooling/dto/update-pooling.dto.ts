import { PartialType } from '@nestjs/mapped-types';
import { CreatePoolingDto } from './create-pooling.dto';

export class UpdatePoolingDto extends PartialType(CreatePoolingDto) {}
