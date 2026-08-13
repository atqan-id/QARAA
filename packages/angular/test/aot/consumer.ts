import { Component, inject } from '@angular/core';
import { QaraaSessionService } from '@atqan/qaraa-angular';

@Component({
  selector: 'qaraa-aot-consumer',
  standalone: true,
  template: '<span>{{ service.snapshot()?.revision ?? 0 }}</span>',
})
export class AotConsumer {
  readonly service = inject(QaraaSessionService);
}
