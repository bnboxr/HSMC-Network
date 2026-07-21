/// hsmc-storage — Full RocksDB persistence with UTXO set, state index, compaction
pub mod block_store;
pub mod tx_store;
pub mod mempool_store;
pub mod utxo_store;
pub mod state_store;

pub use block_store::BlockStore;
pub use tx_store::TxStore;
pub use mempool_store::MempoolStore;
pub use utxo_store::UtxoStore;
pub use state_store::StateStore;

use std::path::Path;
use anyhow::Result;
use rocksdb::{DB, Options, ColumnFamilyDescriptor, BlockBasedOptions, Cache};

pub const CF_BLOCKS:          &str = "blocks";
pub const CF_BLOCKS_BY_HASH:  &str = "blocks_by_hash";
pub const CF_TXS:             &str = "transactions";
pub const CF_TXS_BY_BLOCK:    &str = "txs_by_block";
pub const CF_META:            &str = "meta";
pub const CF_UTXOS:           &str = "utxos";
pub const CF_UTXOS_BY_ADDR:   &str = "utxos_by_addr";
pub const CF_KEY_IMAGES:      &str = "key_images";
pub const CF_STATE:           &str = "state";
pub const CF_MEMPOOL:         &str = "mempool";

pub fn open_db(path: impl AsRef<Path>) -> Result<DB> {
    let path = path.as_ref();
    std::fs::create_dir_all(path)?;

    let mut opts = Options::default();
    opts.create_if_missing(true);
    opts.create_missing_column_families(true);
    opts.set_compression_type(rocksdb::DBCompressionType::Lz4);
    opts.increase_parallelism(num_cpus());
    opts.set_max_open_files(1024);
    opts.set_write_buffer_size(128 * 1024 * 1024); // 128 MB
    opts.set_max_write_buffer_number(4);
    opts.set_target_file_size_base(64 * 1024 * 1024);
    opts.set_level_zero_file_num_compaction_trigger(4);
    opts.set_level_zero_slowdown_writes_trigger(20);
    opts.set_level_zero_stop_writes_trigger(36);
    opts.set_max_bytes_for_level_base(512 * 1024 * 1024);
    opts.set_bytes_per_sync(1024 * 1024);

    let mut block_opts = BlockBasedOptions::default();
    block_opts.set_bloom_filter(10.0, false);
    block_opts.set_block_size(16 * 1024);
    block_opts.set_cache_index_and_filter_blocks(true);
    opts.set_block_based_table_factory(&block_opts);

    let cf_names = [
        CF_BLOCKS, CF_BLOCKS_BY_HASH, CF_TXS, CF_TXS_BY_BLOCK,
        CF_META, CF_UTXOS, CF_UTXOS_BY_ADDR, CF_KEY_IMAGES, CF_STATE, CF_MEMPOOL,
    ];
    let cfs: Vec<_> = cf_names.iter()
        .map(|name| ColumnFamilyDescriptor::new(*name, opts.clone()))
        .collect();

    Ok(DB::open_cf_descriptors(&opts, path, cfs)?)
}

fn num_cpus() -> i32 {
    std::thread::available_parallelism().map(|n| n.get() as i32).unwrap_or(4)
}
