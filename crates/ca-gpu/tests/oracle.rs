use ca_core::{Grid, Rule};
use ca_gpu::{Brush, Simulation};

fn device() -> Option<(wgpu::Device, wgpu::Queue)> {
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::from_env_or_default());
    let adapter =
        match pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions::default()))
        {
            Ok(adapter) => adapter,
            Err(error) => {
                eprintln!("SKIP GPU tests: no headless adapter available: {error}");
                return None;
            }
        };
    eprintln!("GPU oracle adapter: {:?}", adapter.get_info());
    Some(
        pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("ca headless test device"),
            ..Default::default()
        }))
        .expect("available adapter must create a device"),
    )
}
fn encoder(device: &wgpu::Device) -> wgpu::CommandEncoder {
    device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("ca test encoder"),
    })
}
fn read_state(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    sim: &Simulation,
    len: usize,
) -> Vec<u32> {
    let output = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("ca oracle state staging"),
        size: (len * 4) as u64,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut enc = encoder(device);
    sim.copy_state(&mut enc, &output);
    queue.submit([enc.finish()]);
    let (tx, rx) = std::sync::mpsc::channel();
    output.map_async(wgpu::MapMode::Read, .., move |result| {
        tx.send(result).unwrap()
    });
    device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
    rx.recv().unwrap().unwrap();
    let mapped = output.slice(..).get_mapped_range();
    let cells = bytemuck::cast_slice(&mapped).to_vec();
    drop(mapped);
    output.unmap();
    cells
}
#[test]
fn gpu_matches_cpu_for_64_generations() {
    let Some((device, queue)) = device() else {
        return;
    };
    for (width, height) in [(128, 128), (100, 77)] {
        for seed in [1, 42, 987654321] {
            let mut cpu = Grid::seeded(width, height, seed).unwrap();
            let mut next = cpu.clone();
            let mut gpu = Simulation::new(&device, &cpu, wgpu::TextureFormat::Rgba8Unorm);
            // Check intermediate states too, so ping-pong parity bugs cannot hide.
            for generation in 1..=64 {
                cpu.step_into(Rule::Conway, &mut next).unwrap();
                std::mem::swap(&mut cpu, &mut next);
                let mut enc = encoder(&device);
                gpu.step(&mut enc, 1);
                queue.submit([enc.finish()]);
                assert_eq!(
                    read_state(&device, &queue, &gpu, cpu.cells().len()),
                    cpu.cells(),
                    "{width}x{height}, seed {seed}, generation {generation}"
                );
            }
            gpu.reset(&queue, &Grid::seeded(width, height, seed).unwrap())
                .unwrap();
            let mut enc = encoder(&device);
            gpu.step(&mut enc, 64);
            queue.submit([enc.finish()]);
            assert_eq!(
                read_state(&device, &queue, &gpu, cpu.cells().len()),
                cpu.cells(),
                "one batch of 64: {width}x{height}, seed {seed}"
            );
        }
    }
}
#[test]
fn reduction_matches_cpu_and_reuses_ring() {
    let Some((device, queue)) = device() else {
        return;
    };
    let grid = Grid::seeded(100, 77, 53).unwrap();
    let mut gpu = Simulation::new(&device, &grid, wgpu::TextureFormat::Rgba8Unorm);
    for batch in 0..3 {
        for slot in 0..3 {
            let mut enc = encoder(&device);
            gpu.sample(&mut enc, batch, slot);
            queue.submit([enc.finish()]);
        }
        device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
        let mut samples = Vec::new();
        while let Some(sample) = gpu.poll(&device).unwrap() {
            samples.push(sample);
        }
        assert_eq!(samples.len(), 3);
        for sample in samples {
            assert_eq!(sample.population, grid.population());
            assert_eq!(sample.epoch, batch);
        }
    }
}
#[test]
fn brush_matches_integer_clipped_disc() {
    let Some((device, queue)) = device() else {
        return;
    };
    for (center, radius, value) in [([50, 38], 7, 1), ([0, 0], 5, 1), ([99, 76], 32, 0)] {
        let initial = 1 - value;
        let grid = Grid::new(100, 77, vec![initial; 7700]).unwrap();
        let gpu = Simulation::new(&device, &grid, wgpu::TextureFormat::Rgba8Unorm);
        let mut enc = encoder(&device);
        gpu.brush(
            &queue,
            &mut enc,
            Brush {
                center,
                radius,
                value,
            },
        );
        queue.submit([enc.finish()]);
        let actual = read_state(&device, &queue, &gpu, 7700);
        for y in 0..77_i32 {
            for x in 0..100_i32 {
                let dx = x - center[0];
                let dy = y - center[1];
                let expected = if dx * dx + dy * dy <= (radius * radius) as i32 {
                    value
                } else {
                    initial
                };
                assert_eq!(actual[(y * 100 + x) as usize], expected, "cell {x},{y}");
            }
        }
    }
}
