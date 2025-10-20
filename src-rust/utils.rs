use rand::Rng;

pub fn sample<T: Clone>(data: &[T]) -> Option<T> {
    if data.is_empty() {
        return None;
    }

    let mut rng = rand::rng();
    let index = rng.random_range(0..data.len());
    Some(data[index].clone())
}
